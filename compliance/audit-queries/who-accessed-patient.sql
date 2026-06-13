-- who-accessed-patient.sql
-- Complaint-driven access report: every actor who touched a given patient's data, what they did,
-- when, from where, and whether it was under break-glass. Backs the §164.528-style "who accessed
-- my record" answer and the on-demand row of docs/compliance.md §4.4.
--
-- Usage (psql):  psql -d audit -v patient_id='Patient/123' -v days=365 -f who-accessed-patient.sql
-- Defaults if unset: last 365 days. resource_id is matched as the patient compartment, i.e. the
-- target Patient resource itself OR any resource whose id encodes that patient (adjust the LIKE to
-- your resource_id convention; here we match 'Patient/<id>' and '<id>' as a substring of compartment ids).

\if :{?patient_id} \else \set patient_id 'Patient/UNKNOWN' \endif
\if :{?days} \else \set days 365 \endif

WITH target AS (
  -- normalize: allow caller to pass either 'Patient/123' or '123'
  SELECT regexp_replace(:'patient_id', '^Patient/', '') AS pid
)
SELECT
  a.ts,
  a.actor_id,
  a.actor_role,
  a.action,
  a.resource_type,
  a.resource_id,
  a.ip,
  a.user_agent,
  a.justification,
  -- surface break-glass context inline (the access most likely to warrant scrutiny)
  CASE WHEN a.action ILIKE 'BREAK_GLASS%' OR a.justification IS NOT NULL
       THEN 'REVIEW' ELSE '' END AS flag
FROM audit_log a, target t
WHERE a.ts >= now() - make_interval(days => :'days'::int)
  AND (
        a.resource_id = 'Patient/' || t.pid          -- the Patient resource itself
     OR a.resource_id = t.pid                          -- bare id form
     OR a.resource_id LIKE '%' || t.pid || '%'         -- compartment members encoding the patient id
  )
ORDER BY a.ts DESC;

-- Quick rollup: how many distinct actors, and how many break-glass touches, for this patient?
SELECT
  count(*)                                            AS total_accesses,
  count(DISTINCT actor_id)                            AS distinct_actors,
  count(*) FILTER (WHERE action ILIKE 'BREAK_GLASS%') AS break_glass_events
FROM audit_log a, (SELECT regexp_replace(:'patient_id','^Patient/','') AS pid) t
WHERE a.ts >= now() - make_interval(days => :'days'::int)
  AND (a.resource_id = 'Patient/'||t.pid OR a.resource_id = t.pid OR a.resource_id LIKE '%'||t.pid||'%');
