-- bulk-read-anomaly.sql
-- Weekly review (docs/compliance.md §4.4): detect bulk-read / exfiltration patterns — an actor
-- reading an anomalously high NUMBER OF DISTINCT PATIENTS in a short window, relative to that
-- actor's own normal behavior. This is the "data scraping / mass snoop" signature that a flat
-- threshold misses (a busy ICU nurse legitimately touches many patients; the anomaly is the
-- DEVIATION from each actor's baseline, caught with window functions).
--
-- Usage:  psql -d audit -v lookback_days=30 -v bucket='1 hour' -f bulk-read-anomaly.sql
-- Method: bucket each actor's read activity into fixed windows, count distinct patients per bucket,
-- then compute a per-actor rolling mean + stddev over prior buckets (a moving baseline) and flag
-- buckets whose distinct-patient count exceeds mean + 3*stddev (and a small absolute floor so a
-- previously-idle actor suddenly reading 50 charts still trips even with tiny historical variance).

\if :{?lookback_days} \else \set lookback_days 30 \endif
\if :{?bucket}        \else \set bucket '1 hour' \endif

WITH reads AS (
  SELECT
    actor_id, actor_role,
    date_trunc('hour', ts) AS bucket_ts,   -- align with :bucket; change if using a non-hour bucket
    resource_id
  FROM audit_log
  WHERE ts >= now() - make_interval(days => :'lookback_days'::int)
    AND action ILIKE '%read%'                       -- read-class actions only (exfil is reads)
    AND actor_role IN ('clinician','nurse','researcher','admin','ml-engineer')
),
per_bucket AS (
  SELECT
    actor_id, actor_role, bucket_ts,
    count(DISTINCT resource_id) AS distinct_patients,
    count(*)                    AS total_reads
  FROM reads
  GROUP BY actor_id, actor_role, bucket_ts
),
baselined AS (
  SELECT
    actor_id, actor_role, bucket_ts, distinct_patients, total_reads,
    -- rolling baseline over this actor's PRIOR buckets (exclude current row to avoid self-masking)
    avg(distinct_patients) OVER w  AS roll_mean,
    coalesce(stddev_samp(distinct_patients) OVER w, 0) AS roll_stddev,
    count(*)               OVER w  AS prior_buckets
  FROM per_bucket
  WINDOW w AS (
    PARTITION BY actor_id
    ORDER BY bucket_ts
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
  )
),
scored AS (
  SELECT
    *,
    -- z-score vs the actor's own history; guard against zero-variance baselines
    CASE WHEN roll_stddev > 0
         THEN round(((distinct_patients - roll_mean) / roll_stddev)::numeric, 2)
         ELSE NULL END AS z_score
  FROM baselined
)
SELECT
  actor_id,
  actor_role,
  bucket_ts,
  distinct_patients,
  total_reads,
  round(roll_mean::numeric, 1) AS baseline_mean,
  round(roll_stddev::numeric, 1) AS baseline_stddev,
  z_score,
  CASE
    -- statistical outlier vs self, with enough history to trust the baseline
    WHEN prior_buckets >= 5 AND z_score IS NOT NULL AND z_score >= 3
         AND distinct_patients >= 10                 THEN 'ANOMALY (>=3σ vs self)'
    -- cold-start / low-variance safety net: a big absolute spike from a quiet/new actor
    WHEN distinct_patients >= 30 AND roll_mean < 5             THEN 'ANOMALY (absolute spike)'
    ELSE 'normal'
  END AS verdict
FROM scored
WHERE
  (prior_buckets >= 5 AND z_score >= 3 AND distinct_patients >= 10)
  OR (distinct_patients >= 30 AND roll_mean < 5)
ORDER BY z_score DESC NULLS LAST, distinct_patients DESC;
