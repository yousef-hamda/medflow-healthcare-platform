-- chain-verification.sql
-- Recompute the audit_log sha256 hash chain in pure SQL and flag the FIRST row whose stored hash
-- does not match the recomputation (or whose prev_hash does not match the prior row's hash).
--
-- Chain definition (must match audit-service exactly):
--   hash_n = sha256( ts_n || actor_id_n || action_n || resource_type_n || resource_id_n || prev_hash_n )
--   prev_hash_n = hash_{n-1}   (row 1 chains from a published genesis value)
--
-- Used by: make compliance-report (daily), and the audit-chain-broken runbook (incident triage).
-- Requires: pgcrypto (for digest()).  Run against the `audit` database.
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────────┐
-- │ CANONICAL SERIALIZATION CONTRACT                                                           │
-- │ The audit-service builds the pre-image by concatenating the SAME string forms used below.  │
-- │ The load-bearing detail is the timestamp format: this file uses                            │
-- │   to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')                           │
-- │ i.e. UTC, ISO-8601, microsecond precision, trailing 'Z'. If audit-service uses a different │
-- │ canonical form (e.g. epoch millis), change CANON_TS below to match — otherwise EVERY row   │
-- │ will appear mismatched. The separator is '|' (none of the fields may contain a raw '|';     │
-- │ audit-service rejects/escapes that on write).                                              │
-- └──────────────────────────────────────────────────────────────────────────────────────────┘

-- The published genesis value that row 1's prev_hash must equal. Override with -v GENESIS=... to
-- match audit-service's configured genesis. NOTE: keep this \set on its own line with NO trailing
-- comment — psql would otherwise fold the comment text into the variable value.
\set GENESIS 'GENESIS'

WITH ordered AS (
  SELECT
    id, ts, actor_id, actor_role, action, resource_type, resource_id,
    hash AS stored_hash,
    prev_hash AS stored_prev_hash,
    -- canonical timestamp form (SEE CONTRACT ABOVE)
    to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS canon_ts,
    LAG(hash)    OVER (ORDER BY id) AS prior_row_hash,
    ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM audit_log
),
recomputed AS (
  SELECT
    id, rn, ts, actor_id, action, resource_type, resource_id,
    stored_hash, stored_prev_hash, prior_row_hash,
    -- the prev_hash this row SHOULD have chained from
    CASE WHEN rn = 1 THEN :'GENESIS' ELSE prior_row_hash END AS expected_prev_hash,
    -- recompute hash_n over the canonical pre-image, using the row's OWN stored prev_hash
    -- (so a hash mismatch isolates a tampered field; a prev_hash mismatch isolates a broken link)
    encode(
      digest(
        canon_ts || '|' || actor_id || '|' || action || '|' ||
        resource_type || '|' || resource_id || '|' || stored_prev_hash,
        'sha256'
      ),
      'hex'
    ) AS recomputed_hash
  FROM ordered
),
flags AS (
  SELECT
    id, rn, ts, actor_id, action, resource_type, resource_id,
    stored_hash, recomputed_hash, stored_prev_hash, expected_prev_hash,
    (stored_hash      IS DISTINCT FROM recomputed_hash)    AS hash_mismatch,
    (stored_prev_hash IS DISTINCT FROM expected_prev_hash) AS link_mismatch
  FROM recomputed
)
-- Report: the FIRST offending row (smallest id). If this returns zero rows, the chain is intact.
SELECT
  id                                                   AS first_bad_id,
  ts,
  actor_id,
  action,
  resource_type,
  resource_id,
  CASE
    WHEN link_mismatch AND hash_mismatch THEN 'BROKEN LINK + TAMPERED CONTENT'
    WHEN link_mismatch                   THEN 'BROKEN LINK (prev_hash != prior row hash)'
    WHEN hash_mismatch                   THEN 'TAMPERED CONTENT (stored hash != recomputed)'
  END                                                  AS failure_kind,
  stored_hash,
  recomputed_hash,
  stored_prev_hash,
  expected_prev_hash
FROM flags
WHERE hash_mismatch OR link_mismatch
ORDER BY id
LIMIT 1;

-- Companion one-liner: total rows vs first failure position, for the runbook's binary search.
-- (Run separately if you want the summary line.)
-- SELECT count(*) AS total_rows,
--        min(id) FILTER (WHERE FALSE) AS _placeholder   -- replace with flags CTE if materialized
-- FROM audit_log;
