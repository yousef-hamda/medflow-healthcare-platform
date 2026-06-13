-- after-hours-access.sql
-- Weekly information-system-activity review (docs/compliance.md §4.4): clinical PHI access outside
-- normal working hours, a classic snooping / compromised-credential signal. After-hours access is
-- not inherently wrong (nights, on-call, emergencies) — this report surfaces it for human review,
-- prioritizing actors whose behavior is OUTLIER for them.
--
-- Usage:  psql -d audit -v days=7 -v tz='America/New_York' -f after-hours-access.sql
-- "After hours" = before 07:00 or at/after 19:00 LOCAL time, or any time on Sat/Sun.
-- Adjust the window/timezone to your org's defined working hours.

\if :{?days} \else \set days 7 \endif
\if :{?tz}   \else \set tz 'UTC' \endif

WITH access AS (
  SELECT
    a.*,
    a.ts AT TIME ZONE :'tz'                         AS local_ts,
    EXTRACT(HOUR FROM a.ts AT TIME ZONE :'tz')::int AS local_hour,
    EXTRACT(DOW  FROM a.ts AT TIME ZONE :'tz')::int AS local_dow   -- 0=Sun .. 6=Sat
  FROM audit_log a
  WHERE a.ts >= now() - make_interval(days => :'days'::int)
    -- focus on clinical reads/writes by humans; ignore service/system + non-PHI bookkeeping actions
    AND a.actor_role IN ('clinician','nurse','admin')
    AND a.action NOT ILIKE 'BREAK_GLASS%'
),
after_hours AS (
  SELECT *,
    (local_hour < 7 OR local_hour >= 19 OR local_dow IN (0,6)) AS is_after_hours
  FROM access
),
per_actor AS (
  -- baseline each actor against themselves: what share of THEIR activity is after-hours?
  SELECT
    actor_id, actor_role,
    count(*)                                            AS total_accesses,
    count(*) FILTER (WHERE is_after_hours)              AS after_hours_accesses,
    round(100.0 * count(*) FILTER (WHERE is_after_hours) / NULLIF(count(*),0), 1) AS after_hours_pct,
    count(DISTINCT resource_id) FILTER (WHERE is_after_hours) AS distinct_patients_after_hours,
    min(ts) FILTER (WHERE is_after_hours)               AS first_after_hours,
    max(ts) FILTER (WHERE is_after_hours)               AS last_after_hours
  FROM after_hours
  GROUP BY actor_id, actor_role
)
SELECT
  actor_id,
  actor_role,
  total_accesses,
  after_hours_accesses,
  after_hours_pct,
  distinct_patients_after_hours,
  first_after_hours,
  last_after_hours,
  -- prioritize review: lots of after-hours touches across many patients is the snooping shape
  CASE
    WHEN distinct_patients_after_hours >= 10 AND after_hours_pct >= 50 THEN 'HIGH'
    WHEN distinct_patients_after_hours >= 5                            THEN 'MEDIUM'
    ELSE 'LOW'
  END AS review_priority
FROM per_actor
WHERE after_hours_accesses > 0
ORDER BY distinct_patients_after_hours DESC, after_hours_accesses DESC;
