-- deid-activity.sql
-- Monthly review (docs/compliance.md §4.4): de-identification activity. Every de-id job is itself
-- audited (deid-service emits to audit.events). This report shows what was de-identified, by whom/
-- which pipeline, at what volume, and surfaces anomalies (de-id runs from unexpected actors, spikes,
-- or failures) — the de-id path is a privileged one (it holds the re-identification keys), so its
-- own activity is monitored.
--
-- Usage:  psql -d audit -v days=30 -f deid-activity.sql   (default: last 30 days)
-- Assumes deid actions are recorded as action IN ('DEID_TEXT','DEID_FHIR','DEID_BATCH') (or any
-- action ILIKE 'DEID%'); resource_type captures what was de-identified (e.g. 'DocumentReference',
-- 'Patient', 'Bundle'); actor_id is the calling pipeline/service or user.

\if :{?days} \else \set days 30 \endif

-- 1) Volume + mix: who ran de-id, against what, how much.
WITH deid AS (
  SELECT *
  FROM audit_log
  WHERE action ILIKE 'DEID%'
    AND ts >= now() - make_interval(days => :'days'::int)
)
SELECT
  date_trunc('day', ts)            AS day,
  actor_id,
  actor_role,
  resource_type,
  count(*)                         AS jobs,
  count(DISTINCT resource_id)      AS distinct_resources,
  min(ts)                          AS first_run,
  max(ts)                          AS last_run
FROM deid
GROUP BY 1, actor_id, actor_role, resource_type
ORDER BY day DESC, jobs DESC;

-- 2) Anomaly flags: de-id invoked by actors OTHER than the expected pipeline identities, and
--    daily-volume spikes vs the trailing 7-day mean (window function over the daily series).
WITH deid AS (
  SELECT * FROM audit_log
  WHERE action ILIKE 'DEID%' AND ts >= now() - make_interval(days => :'days'::int)
),
daily AS (
  SELECT date_trunc('day', ts) AS day, count(*) AS jobs
  FROM deid GROUP BY 1
),
trended AS (
  SELECT
    day, jobs,
    avg(jobs) OVER (ORDER BY day ROWS BETWEEN 7 PRECEDING AND 1 PRECEDING) AS prior7_mean
  FROM daily
)
SELECT
  'volume_spike' AS anomaly,
  day::text       AS detail,
  jobs,
  round(prior7_mean::numeric,1) AS baseline,
  'daily de-id volume >> trailing-7d mean' AS note
FROM trended
WHERE prior7_mean IS NOT NULL AND jobs > GREATEST(prior7_mean * 3, prior7_mean + 50)

UNION ALL

SELECT
  'unexpected_actor' AS anomaly,
  actor_id           AS detail,
  count(*)           AS jobs,
  NULL               AS baseline,
  'de-id run by an actor outside the expected pipeline identities' AS note
FROM deid
WHERE actor_id NOT IN ('deid-service','airflow:silver_to_omop','airflow:feature_backfill')  -- adjust allowlist
GROUP BY actor_id
ORDER BY 1, jobs DESC;
