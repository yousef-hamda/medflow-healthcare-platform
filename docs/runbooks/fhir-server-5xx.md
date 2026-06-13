# Runbook: FHIR server returning 5xx

> Scope: the HAPI FHIR R4 server (`apps/fhir-server`, :8090) is returning 5xx, timing out, or
> failing health checks. It is the **operational source of truth** for clinical resources and the
> bottleneck of the system by design
> ([architecture.md §5](../architecture.md#5-scaling-story)), so this is a care-impacting incident.
>
> **Severity:** SEV-2 (SEV-1 if sustained and care delivery is blocked). Blast radius: HL7v2
> mapping writes, DICOM `ImagingStudy` writes, and the gateway FHIR proxy (clinician/patient reads).
> The realtime sepsis path does **not** depend on the FHIR server and keeps working.

## Symptoms

- Gateway FHIR proxy returns 502/503/504; clinician dashboard patient view fails to load charts.
- `curl http://localhost:8090/actuator/health` is non-200 or hangs.
- hl7v2-ingester logs show write failures and is **NAKing** messages (correct behavior: raw is
  already safe in `hl7.raw`, sender will retry).
- dicom-receiver rejects/queues C-STORE `ImagingStudy` upserts.
- Prometheus alerts on FHIR server error rate / latency / `down`.

## Diagnose

```bash
# 1. Is it up, and what does its own health say?
docker compose ps fhir-server
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8090/actuator/health
curl -s http://localhost:8090/actuator/health | python3 -m json.tool   # component breakdown (db, diskSpace)

# 2. A trivial FHIR read — isolates "app up" from "DB reachable"
curl -s -o /dev/null -w "metadata=%{http_code} time=%{time_total}s\n" \
  http://localhost:8090/fhir/metadata
curl -s -o /dev/null -w "patient_search=%{http_code} time=%{time_total}s\n" \
  "http://localhost:8090/fhir/Patient?_count=1"

# 3. App logs — distinguish the four common causes
docker compose logs --tail=200 fhir-server | grep -iE \
  "ERROR|Exception|OutOfMemory|GC overhead|connection|deadlock|timeout|HTTP 5"

# 4. The usual root cause: Postgres 'fhir' DB
docker compose exec postgres pg_isready -U medflow
docker compose exec postgres psql -U medflow -d fhir -c \
  "SELECT count(*) AS active, state FROM pg_stat_activity WHERE datname='fhir' GROUP BY state;"
docker compose exec postgres psql -U medflow -d fhir -c \
  "SELECT pid, now()-query_start AS dur, wait_event_type, left(query,80) AS q
   FROM pg_stat_activity WHERE datname='fhir' AND state<>'idle' ORDER BY dur DESC LIMIT 10;"
docker compose exec postgres psql -U medflow -d fhir -c \
  "SELECT count(*) FROM pg_locks WHERE NOT granted;"   # lock contention / deadlocks

# 5. Resource pressure (HAPI is a JVM — heap and DB pool are the usual limits)
docker stats --no-stream fhir-server postgres
docker compose logs --tail=80 fhir-server | grep -iE "HikariPool|connection is not available|timeout"
```

Classify:

- **DB down / unreachable** → health `db` DOWN, `pg_isready` fails → fix Postgres.
- **DB up but slow / pool exhausted** → `HikariPool ... connection is not available`, many active
  sessions, long-running queries / unbounded FHIR search → query/pool problem.
- **JVM OOM / GC death spiral** → `OutOfMemoryError` / `GC overhead limit` → heap problem.
- **App-level bug / bad deploy** → 5xx with stack traces, started right after a deploy.

## Remediate

**DB down/unreachable:** restore Postgres first (it backs `fhir` plus other DBs). The ingester is
already NAKing and the raw HL7 is in `hl7.raw`, so no data is lost — senders replay on recovery.

```bash
docker compose restart postgres
# wait for ready, then confirm FHIR recovers
docker compose exec postgres pg_isready -U medflow && \
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8090/actuator/health
```

**Pool exhaustion / slow queries:** identify and (if safe) cancel a pathological long-running query;
an unbounded FHIR search (`Patient?` with no constraints) or a backfill hammering the operational
DB is a common culprit — that load belongs on the lakehouse, not the FHIR server.

```bash
# cancel a specific runaway query by pid (from the diagnose step)
docker compose exec postgres psql -U medflow -d fhir -c "SELECT pg_cancel_backend(<PID>);"
```

Then restart the FHIR server to reset the connection pool, and rate-limit/redirect the abusive
caller at the gateway.

**JVM OOM:** restart to clear the death spiral, then address cause (raise heap, or fix the
query/result-set that ballooned memory — large `_include`/`_revinclude` searches are classic).

```bash
docker compose restart fhir-server
docker compose logs -f fhir-server | grep -iE "Started .*Application|actuator"   # watch it come back
```

**Bad deploy:** roll back to the last-known-good image tag (compose: pin the previous tag and
`up -d fhir-server`; K8s/ArgoCD: roll back the Application to the previous synced revision).

**While recovering — confirm the safety properties hold:**

```bash
# raw HL7 is still durable regardless of FHIR being down (no data loss)
docker compose exec kafka kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list localhost:9092 --topic hl7.raw | tail
# realtime sepsis path is independent and should be unaffected
docker compose logs --tail=20 realtime-gateway | grep -iE "alert|connected"
```

## Escalate

- **Postgres itself is unrecoverable / corrupt** → DBA + platform on-call; consider PITR restore
  ([restore-drill](restore-drill.md)), accepting RPO ≤15 min.
- **OOM recurs after restart with no deploy change** → fhir-server owner; likely a query pattern or
  heap-sizing issue needing a real fix, not a bounce.
- **Sustained outage blocking care** → escalate to SEV-1, notify clinical leads of degraded mode
  (dashboards fall back to whatever is cached; live sepsis alerts continue independently).

## Prevent

- **Keep analytical load off the operational DB** — the entire `fhir.changes` → lakehouse design
  exists so reads offload to Trino/OMOP. A backfill or report hitting the FHIR server directly is
  an anti-pattern; catch it in review.
- Bound FHIR search at the proxy (require constraints / default `_count`, cap `_include` depth) so
  no single query can exhaust the pool.
- Right-size HikariCP pool vs Postgres `max_connections`; alert on pool saturation before 5xx.
- Production path (per [scaling story](../architecture.md#5-scaling-story)): bigger RDS, read
  replicas for FHIR search, partitioned HAPI if multi-tenant.
- Keep liveness/readiness probes on `/actuator/health` so K8s restarts a wedged instance and
  routes around an unready one automatically.
