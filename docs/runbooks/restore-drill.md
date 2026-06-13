# Runbook: Restore drill (Postgres PITR + MinIO versioned restore)

> Scope: the **quarterly disaster-recovery drill** that proves the targets in
> [compliance.md §9](../compliance.md#9-backup--disaster-recovery): **RPO 15 min, RTO 4 h** for the
> Postgres databases and the MinIO/S3 lakehouse + imaging, and that the audit chain verifies across
> the restore point. Per §164.308(a)(7) / §164.310(d)(2)(iv).
>
> The drill's pass criterion is **not** "the snapshot restored." It is: *the restored FHIR server
> passes smoke tests, the audit chain verifies across the restore point, and we measured the actual
> RPO/RTO and they met target.* A restore that comes back with a broken chain or stale data is a
> **failed drill**, which is the point of drilling.

## When / where

- Cadence: **quarterly**, plus after any major change to the backup/replication topology.
- Run in an **isolated restore environment** (a scratch namespace / separate compose project), never
  over production. The drill must not touch live data or the live WORM bucket (read-only there).
- Roles: one operator running the steps, one timekeeper recording wall-clock for RTO and the
  restore-point timestamp for RPO.

## Pre-drill: record the targets and pick a restore point

```bash
# Record drill start (RTO clock starts when you declare "disaster").
date -u +%Y%m%dT%H%M%SZ | tee /tmp/drill_start.txt

# Choose a target restore time ~ "now minus a few minutes" and note it. RPO is measured as
# (target_restore_time  -  last_durable_change_actually_recoverable).
TARGET_RESTORE_TS="$(date -u -d '-5 minutes' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$TARGET_RESTORE_TS" | tee /tmp/drill_target_ts.txt
```

## Part A — Postgres PITR (point-in-time recovery)

Production uses WAL archiving / RDS automated backups with 15-min log shipping; locally the
mechanics are base backup + WAL replay. The drill validates the *procedure* and the *RPO*.

```bash
# A1. Provision a clean Postgres in the restore environment (do not point at prod volumes).
#     AWS: restore an RDS instance to the chosen point-in-time:
#       aws rds restore-db-instance-to-point-in-time \
#         --source-db-instance-identifier medflow-prod \
#         --target-db-instance-identifier medflow-drill \
#         --restore-time "$TARGET_RESTORE_TS"
#     Local: start a fresh Postgres, restore the latest base backup, then replay WAL up to target.

# A2. Replay WAL to the target time (recovery_target_time = $TARGET_RESTORE_TS), then promote.
#     Confirm the server reached the target and opened read/write:
docker compose -p medflow-drill exec postgres-drill pg_isready -U medflow
docker compose -p medflow-drill exec postgres-drill psql -U medflow -d audit -c \
  "SELECT now() AS restored_clock, max(ts) AS latest_audit_row FROM audit_log;"

# A3. Measure RPO: how close is the latest recoverable row to the disaster moment?
#     latest_audit_row should be within ~15 min of the target restore time => RPO met.
```

## Part B — MinIO / S3 versioned restore (lakehouse + imaging)

S3 versioning is continuous; Delta time travel covers logical corruption. The drill restores object
state to the target point.

```bash
# B1. Confirm versioning is on (prereq for point-in-time object recovery).
docker compose exec minio mc version info local/lakehouse
docker compose exec minio mc version info local/imaging

# B2. Restore objects to the target time into the drill bucket (versioned copy/rewind).
#     AWS: replay/rewind to the version current at $TARGET_RESTORE_TS (S3 Batch / versioned copy).
#     MinIO: use --version-id selection or `mc cp --versions` against the target timestamp.
docker compose exec minio mc ls --versions local/lakehouse/gold/person/ | head

# B3. Delta logical-corruption check (independent of infra restore): can we time-travel gold
#     to a known-good version? (this is the "bad deploy wrote garbage" recovery path)
docker compose -p medflow-drill exec spark-master spark-sql -e \
  "SELECT count(*) FROM delta.\`s3a://lakehouse/gold/person\` VERSION AS OF <N>;"
```

## Part C — Verify (the actual pass/fail criteria)

```bash
# C1. FHIR server smoke test against the RESTORED database.
curl -s -o /dev/null -w "metadata=%{http_code}\n" http://localhost:18090/fhir/metadata
curl -s "http://localhost:18090/fhir/Patient?_count=5" \
  | python3 -c "import sys,json;b=json.load(sys.stdin);print('patients:',b.get('total'))"
curl -s -o /dev/null -w "encounter_search=%{http_code}\n" \
  "http://localhost:18090/fhir/Encounter?_count=1"

# C2. AUDIT CHAIN VERIFIES ACROSS THE RESTORE POINT — the compliance-critical check.
#     Recompute the chain in the restored audit DB; it must verify end to end with NO mismatch.
docker compose -p medflow-drill exec postgres-drill psql -U medflow -d audit \
  -f - < compliance/audit-queries/chain-verification.sql
#     Then cross-check the restored terminal hash against the WORM export that covers the
#     restore point (read-only). The restored chain's hash at day-D boundary must equal the
#     object-locked WORM terminal hash for day D — proving the restore didn't lose/alter rows.
docker compose exec minio mc cat local/audit-worm/<YYYY/MM/DD>/audit.jsonl.gz | gunzip | tail -1

# C3. Cross-store referential sanity (restored FHIR vs restored lake person count, same ballpark).
docker compose -p medflow-drill exec spark-master spark-sql -e \
  "SELECT count(*) FROM delta.\`s3a://lakehouse/gold/person\`;"
```

## Part D — Measure RTO/RPO and record the result

```bash
# RTO = (declared-recovered wall-clock) - (drill_start). Must be <= 4h.
date -u +%Y%m%dT%H%M%SZ | tee /tmp/drill_end.txt
echo "RTO start: $(cat /tmp/drill_start.txt)  end: $(cat /tmp/drill_end.txt)"
# RPO = (target restore time) - (latest recoverable row). Must be <= 15 min.
echo "RPO target: $(cat /tmp/drill_target_ts.txt)"
```

**Pass criteria (all must hold):**

- [ ] Postgres restored to the target point; `pg_isready` + smoke queries succeed.
- [ ] **RPO ≤ 15 min** (latest recoverable audit/FHIR row within 15 min of the disaster moment).
- [ ] **RTO ≤ 4 h** (wall-clock from "disaster declared" to "FHIR smoke tests green").
- [ ] FHIR server smoke tests pass against the restored DB.
- [ ] **Audit chain verifies end-to-end across the restore point** *and* matches the WORM terminal
      hash — no mismatch (else: SEV-1, see [audit-chain-broken](audit-chain-broken.md)).
- [ ] Lakehouse objects/Delta versions restored and queryable; counts sane vs FHIR.

## Escalate / fail-handling

- **RPO missed** (recoverable data older than 15 min) → backup-frequency / WAL-shipping problem;
  platform + DBA on-call; the 15-min target is not actually being met in production config.
- **RTO missed** (restore took > 4h) → procedure or automation gap; fix the runbook/tooling that
  slowed it before the next quarter.
- **Chain fails to verify across the restore point** → SEV-1, pivot to
  [audit-chain-broken](audit-chain-broken.md); a restore that breaks the chain means either the
  backup captured a tampered state or the restore lost rows — both are serious.
- **WORM terminal hash mismatch** → the external anchor and the restore disagree; treat as a
  security incident, engage compliance.

## Prevent / improve

- Automate the drill end-to-end so quarterly execution is push-button and RTO shrinks each cycle.
- Drilling exposes the difference between *infrastructure loss* (PITR + versioned restore) and
  *logical corruption* (Delta time travel + PITR to just-before-the-bad-write) — keep both paths
  exercised.
- Feed measured RPO/RTO back into the DR table in
  [compliance.md §9](../compliance.md#9-backup--disaster-recovery); if reality drifts from the
  targets, fix the config or fix the table (honestly).
- Note: a runbook-level restore drill is **not** the same as an org-level, documented contingency
  plan test — that is a named gap ([compliance.md gap #4](../compliance.md#11-gaps--roadmap-the-honest-table)).
