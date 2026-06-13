# Runbook: Audit hash-chain verification failure — SECURITY INCIDENT

> **THIS IS A SECURITY INCIDENT.** A break in the `audit_log` hash chain means the tamper-evidence
> property of the audit trail has been violated or corrupted. Treat it as a potential PHI-integrity
> incident under **HIPAA §164.308(a)(6) (Security Incident Procedures)** until proven benign.
> Chain design and tamper-evidence math: [compliance.md §4](../compliance.md#4-audit-controls).
>
> **Severity:** SEV-1 (security). Page the security/compliance on-call **immediately** — before
> deep diagnosis. Do not "fix" the chain. Do not delete or rewrite rows. Preserve everything.

## Chain definition (the invariant you are verifying)

```
hash_n = sha256( ts_n || actor_id_n || action_n || resource_type_n || resource_id_n || prev_hash_n )
```

with `prev_hash_n = hash_{n-1}` and row 1 chaining from a published genesis value. Any in-place edit
of row *k* changes `hash_k`, so recomputation mismatches at *k* (and the stored `prev_hash` of *k+1*
no longer matches). The table is append-only at the DB layer (triggers `audit_log_no_update`,
`audit_log_no_truncate` block UPDATE/DELETE/TRUNCATE for **every** role incl. the owner).

## Symptoms

- `make compliance-report` / the daily automated check reports a chain mismatch, or
  [`chain-verification.sql`](../../compliance/audit-queries/chain-verification.sql) flags a first
  mismatch row.
- `audit-service` `/audit/verify-chain` returns a failure with a row id.
- Falco fired on `DROP TRIGGER`/`ALTER TABLE` against the `audit` DB, or a `kubectl exec` into the
  audit namespace.
- The daily `audit_worm_export` is late/missing (tampering window unbounded — see
  [airflow-dag-failure](airflow-dag-failure.md)).

## STEP 1 — CONTAIN: freeze writes and preserve evidence (do this first)

```bash
# 1a. Page security/compliance on-call NOW (out of band). Start an incident timeline.

# 1b. Freeze further audit writes so the chain stops moving while you investigate.
#     Stop the writer (audit-service consumer); events SAFELY accumulate in the
#     audit.events Kafka topic (7-day retention) and are NOT lost.
docker compose stop audit-service

# 1c. Snapshot the current audit DB and the Kafka backlog as evidence (read-only, do NOT modify).
docker compose exec postgres pg_dump -U medflow -d audit -t audit_log --no-owner \
  > /tmp/incident_audit_$(date -u +%Y%m%dT%H%M%SZ).sql
docker compose exec kafka kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 --topic audit.events | tee /tmp/incident_auditevents_offsets.txt

# 1d. Do NOT touch the WORM export — it is your independent ground truth (read-only, object-locked).
```

## STEP 2 — DIAGNOSE: locate the first bad row (binary search) and compare to WORM

### 2a. Recompute the chain in SQL and find the FIRST mismatch

```bash
docker compose exec postgres psql -U medflow -d audit \
  -f - < compliance/audit-queries/chain-verification.sql
# Returns the first row id where stored hash != recomputed hash, or where prev_hash != prior hash.
```

### 2b. Confirm with the service endpoint and narrow by binary search

`/audit/verify-chain` verifies a contiguous range; binary-search the **last-good** id by halving:

```bash
# verify a range [lo, hi]; if it fails, the first bad row is in this range — halve and repeat
curl -s "http://localhost:8095/audit/verify-chain?from_id=1&to_id=1000000" | python3 -m json.tool
curl -s "http://localhost:8095/audit/verify-chain?from_id=1&to_id=500000"  | python3 -m json.tool
curl -s "http://localhost:8095/audit/verify-chain?from_id=500001&to_id=750000" | python3 -m json.tool
# ... converge on the smallest [k] that fails => row k is the first tampered/corrupted row.
```

### 2c. Compare against the WORM snapshots (the external anchor)

The daily WORM export holds each day's rows **plus that day's terminal hash**, object-locked
(compliance mode, 6y). It cannot have been altered by a DB-only attacker. Compare the live chain to
the last export that *precedes* row *k*:

```bash
# list exports and pull the last-good day's export
docker compose exec minio mc ls --recursive local/audit-worm/ | tail
docker compose exec minio mc cat local/audit-worm/<YYYY/MM/DD>/audit.jsonl.gz \
  | gunzip | tail -1   # the day's terminal hash + last row

# Does the live chain still match the WORM terminal hash at that day's boundary?
#  - MATCH at day D, MISMATCH after  => tampering/corruption occurred AFTER export D.
#    Window of exposure is bounded to [export D, now] — at most ~24h of unanchored rows.
#  - The WORM copy is authoritative for everything up to its terminal hash.
```

### 2d. Determine: malice vs corruption

```bash
# Was the append-only protection bypassed via DDL? (the only way to silently edit rows)
docker compose logs --tail=500 postgres | grep -iE "DROP TRIGGER|ALTER TABLE|audit_log|TRUNCATE"
# Falco runtime alerts (DDL on audit DB / exec into audit pod are pre-tuned rules)
docker compose logs --tail=300 falco 2>/dev/null | grep -iE "audit|DROP TRIGGER|exec"
# Who/what touched the audit DB around the first-bad-row timestamp?
docker compose exec postgres psql -U medflow -d audit -c \
  "SELECT id, ts, actor_id, actor_role, action FROM audit_log WHERE id BETWEEN <k-3> AND <k+3>;"
```

- **DDL evidence (DROP/ALTER TRIGGER) + clean post-*k* chain** → deliberate tampering: an attacker
  with DB DDL rights dropped the triggers, rewrote a consistent suffix, and the only thing that
  caught it is the WORM anchor mismatch. **Malicious.**
- **No DDL, isolated single-row hash mismatch, no consistent suffix** → likely corruption (disk/bit
  error, a serialization bug producing a wrong hash for one row). Still handled as an incident until
  confirmed benign.

## STEP 3 — REMEDIATE / RECOVER

- **Do NOT edit the audit_log to "repair" hashes.** Repairing in place destroys evidence and is
  itself a violation of the append-only invariant.
- **Authoritative record = the WORM export up to its last verified terminal hash**, plus the
  `audit.events` Kafka backlog for events after the last export (these are un-tampered, just not yet
  chained). Reconstruct the correct post-export tail **in a new, quarantined table/instance** from
  the Kafka events and compare to the suspect live rows to identify exactly which rows were altered
  or fabricated.
- If tampering is confirmed, the live `audit` DB is **compromised evidence**: rebuild the audit DB
  from the WORM exports + replayed `audit.events`, rotate the DB credentials and any keys reachable
  from the compromised host, and restart `audit-service` only after the chain re-verifies end to end.
- If corruption (benign) is confirmed, document the single affected row, restore from WORM, and
  re-anchor.

## STEP 4 — §164.308(a)(6) incident procedure & notification path

1. **Respond and report:** the security/compliance on-call (paged in Step 1) runs the documented
   incident procedure — classify, contain (done), eradicate, recover, and **document every step
   with timestamps** (the incident timeline started in Step 1a).
2. **Assess for breach:** determine whether the integrity violation implies unauthorized
   access/alteration of PHI or of the disclosure record. The audit log records *who accessed whom*;
   tampering with it can mask a PHI access — so a chain break is treated as potential evidence of a
   prior PHI access incident, not just a logging glitch.
3. **Notification clock:** if a reportable breach is determined, the **§164.404 60-day notification
   clock** applies (individuals; HHS; media if ≥500). Counsel/privacy officer owns the
   determination and the clock. (Note: the formal IR program + breach workflow is a named
   organizational gap — [compliance.md gap #5](../compliance.md#11-gaps--roadmap-the-honest-table);
   this runbook covers the one technical scenario, not the whole program.)
4. **Preserve:** keep `/tmp/incident_*` snapshots, the WORM exports, Postgres logs, and Falco
   alerts as evidence per the incident-handling/evidence rules.

## Escalate

- **Always, immediately:** security/compliance on-call (this is SEV-1 by definition).
- **DDL/tampering confirmed** → CISO / privacy officer; engage IR and legal for the breach
  determination and §164.404 clock.
- **Cannot reconstruct authoritative tail from WORM + Kafka** → platform + data on-call; this means
  the external anchor or the event backlog is also compromised — a much larger incident.

## Prevent

- **Keep the WORM anchor healthy:** alert hard on a late/missing `audit_worm_export` — the export
  cadence (24h) is the *maximum* tamper-detection window; a missed export widens it.
- **Least privilege on the audit DB:** no role should hold DDL on `audit`; the append-only triggers
  are the last line and dropping them must require break-glass + page (Falco rule already targets
  `DROP TRIGGER`/`ALTER TABLE` on `audit`).
- **Separate WORM-export credentials** (write-once, no delete) so a DB compromise can't reach the
  anchor; object-lock compliance mode means even root can't shorten retention.
- **Continuous verification:** run `chain-verification.sql` daily (automated) *and* on a randomized
  cadence, so an attacker can't predict the verification window.
- Cross-reference Vault's own audit device with `audit.events` so a decrypt that isn't in our chain
  (or vice versa) is itself a detectable anomaly.
