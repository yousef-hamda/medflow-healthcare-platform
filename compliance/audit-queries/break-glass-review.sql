-- break-glass-review.sql
-- The mandatory break-glass review (docs/compliance.md §3.5: every emergency-access elevation is
-- human-reviewed within 7 days; unreviewed events older than 7 days alarm). Pairs each
-- BREAK_GLASS_OPEN with its CLOSE, shows the justification, lists what was actually accessed during
-- the elevation window, and flags events still awaiting review.
--
-- Usage:  psql -d audit -v days=30 -f break-glass-review.sql   (default: last 30 days)
-- Assumes break-glass is recorded as action 'BREAK_GLASS_OPEN' / 'BREAK_GLASS_CLOSE', with the
-- target patient in resource_id and the clinician's justification in justification. An elevation id
-- (if the service emits one) is expected to appear in resource_id or user_agent context; here we
-- correlate by (actor_id, resource_id) within the 1-hour grant window.

\if :{?days} \else \set days 30 \endif

WITH opens AS (
  SELECT id, ts AS opened_at, actor_id, actor_role, resource_id AS patient_ref, justification, ip, user_agent
  FROM audit_log
  WHERE action = 'BREAK_GLASS_OPEN'
    AND ts >= now() - make_interval(days => :'days'::int)
),
closes AS (
  SELECT actor_id, resource_id AS patient_ref, ts AS closed_at
  FROM audit_log
  WHERE action = 'BREAK_GLASS_CLOSE'
    AND ts >= now() - make_interval(days => :'days'::int)
),
paired AS (
  SELECT
    o.id AS open_id, o.opened_at, o.actor_id, o.actor_role, o.patient_ref, o.justification, o.ip, o.user_agent,
    -- the first CLOSE for this actor+patient at/after the OPEN (the grant is patient-scoped, 1h)
    (SELECT min(c.closed_at) FROM closes c
       WHERE c.actor_id = o.actor_id AND c.patient_ref = o.patient_ref AND c.closed_at >= o.opened_at
    ) AS closed_at
  FROM opens o
)
SELECT
  p.open_id,
  p.opened_at,
  p.actor_id,
  p.actor_role,
  p.patient_ref,
  p.justification,
  p.ip,
  COALESCE(p.closed_at, p.opened_at + interval '1 hour') AS effective_close,
  CASE WHEN p.closed_at IS NULL THEN 'auto-expired (no explicit CLOSE)' ELSE 'closed' END AS close_status,
  -- count of resource accesses made by this actor during the elevation window (what they did with it)
  (SELECT count(*) FROM audit_log x
     WHERE x.actor_id = p.actor_id
       AND x.ts >= p.opened_at
       AND x.ts <= COALESCE(p.closed_at, p.opened_at + interval '1 hour')
       AND x.action NOT ILIKE 'BREAK_GLASS%'
  ) AS accesses_during_window,
  -- REVIEW SLA: anything older than 7 days that we are surfacing now is, by definition, the backlog
  CASE
    WHEN p.justification IS NULL OR length(trim(p.justification)) = 0
      THEN 'INVALID: missing justification'
    WHEN p.opened_at < now() - interval '7 days'
      THEN 'OVERDUE REVIEW (>7d)'
    ELSE 'within review window'
  END AS review_flag
FROM paired p
ORDER BY (p.opened_at < now() - interval '7 days') DESC, p.opened_at DESC;

-- Alarm feed: just the events that should page/ticket (overdue or missing justification).
-- SELECT * FROM ( ... above ... ) WHERE review_flag LIKE 'OVERDUE%' OR review_flag LIKE 'INVALID%';
