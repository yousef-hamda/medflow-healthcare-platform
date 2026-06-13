# Audit-review queries

Runnable SQL backing the information-system-activity reviews in
[docs/compliance.md §4.4](../../docs/compliance.md#44-review-procedures) (§164.308(a)(1)(ii)(D))
and the tamper-evidence story in [§4.2](../../docs/compliance.md#42-tamper-evidence-math-and-its-limits).
All queries run against the `audit` database's `audit_log` table
(DDL: `infra/docker/postgres/init-audit.sql`).

## Schema (the columns every query assumes)

```
audit_log(
  id BIGINT identity, ts TIMESTAMPTZ, actor_id TEXT, actor_role TEXT, action TEXT,
  resource_type TEXT, resource_id TEXT, ip INET, user_agent TEXT, justification TEXT,
  hash TEXT, prev_hash TEXT )
```

The table is **append-only** at the DB layer (triggers block UPDATE/DELETE/TRUNCATE for every role
incl. owner) and **hash-chained**:
`hash_n = sha256( ts || actor_id || action || resource_type || resource_id || prev_hash )`.

## The queries

| File | Review (cadence) | What it answers |
|---|---|---|
| [`chain-verification.sql`](chain-verification.sql) | chain integrity (daily + on-demand) | Recomputes the sha256 chain in pure SQL (`pgcrypto` `digest()`) and returns the **first** row whose stored hash ≠ recomputed, or whose `prev_hash` ≠ the prior row's hash. Zero rows = intact. |
| [`who-accessed-patient.sql`](who-accessed-patient.sql) | per-patient report (on demand) | Every actor who touched a given patient — what, when, from where, under break-glass? §164.528-style answer. |
| [`break-glass-review.sql`](break-glass-review.sql) | break-glass (within 7 days) | Pairs each `BREAK_GLASS_OPEN` with its CLOSE, shows the justification + what was accessed during the 1h grant, flags **overdue** and **missing-justification** events. |
| [`after-hours-access.sql`](after-hours-access.sql) | after-hours (weekly) | Clinical PHI access outside working hours, baselined per actor; prioritizes outliers. |
| [`bulk-read-anomaly.sql`](bulk-read-anomaly.sql) | bulk-read anomaly (weekly) | Window-function rate anomaly: per-actor rolling mean+stddev of distinct patients per time bucket; flags spikes (≥3σ vs self, plus an absolute-spike safety net). |
| [`deid-activity.sql`](deid-activity.sql) | de-id activity (monthly) | Volume/mix of de-identification jobs; anomalies (unexpected actor, daily-volume spike). |

## Running them

```bash
# directly against the local audit DB (compose):
docker compose exec postgres psql -U medflow -d audit \
  -f - < compliance/audit-queries/chain-verification.sql

# parameterized queries take psql -v variables (defaults shown):
docker compose exec -T postgres psql -U medflow -d audit \
  -v patient_id="Patient/123" -v days=365 \
  -f - < compliance/audit-queries/who-accessed-patient.sql

docker compose exec -T postgres psql -U medflow -d audit \
  -v days=7 -v tz="America/New_York" \
  -f - < compliance/audit-queries/after-hours-access.sql

docker compose exec -T postgres psql -U medflow -d audit \
  -v lookback_days=30 -v bucket="1 hour" \
  -f - < compliance/audit-queries/bulk-read-anomaly.sql

# convenience target runs the example set:
make audit-query
```

> `chain-verification.sql` is also what `make compliance-report` runs daily and what the
> [audit-chain-broken runbook](../../docs/runbooks/audit-chain-broken.md) uses to binary-search the
> first tampered row during a security incident.

## Two contracts you must keep aligned

1. **Canonical serialization for the hash.** `chain-verification.sql` recomputes the pre-image with
   `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` and `'|'` separators. This
   **must** match exactly how `audit-service` builds the hash on write. If the service uses a
   different timestamp form (e.g. epoch millis) or separator, every row will appear mismatched —
   adjust `CANON_TS`/separator in the query to match, don't "fix" the data. The genesis value is
   overridable with `-v GENESIS=...`.
2. **Action / actor naming.** The break-glass query assumes `BREAK_GLASS_OPEN` / `BREAK_GLASS_CLOSE`;
   the de-id query assumes `action ILIKE 'DEID%'` and an allowlist of expected de-id actor ids.
   These match the actions emitted by the gateway/deid-service; if those strings change, update the
   filters here (they are flagged in-file with `-- adjust ...`).

> These queries were authored and executed against a seeded copy of the real `audit_log` schema
> with a valid hash chain: the verifier returns 0 rows on an intact chain and pinpoints the exact
> `first_bad_id` when a row is tampered. They are runnable as-is, not illustrative pseudo-SQL.
