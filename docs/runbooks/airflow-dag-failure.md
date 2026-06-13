# Runbook: Airflow DAG failure

> Scope: a scheduled lakehouse DAG (`synthea_to_bronze`, `hl7_to_bronze`, `vitals_to_bronze`,
> `dicom_manifest_to_bronze`, `bronze_to_silver`, `silver_to_omop`, `feature_backfill`,
> `audit_worm_export`) has failed or a Great Expectations gate tripped. See
> [architecture.md §2.5](../architecture.md#25-lakehouse-and-batch).
>
> **Severity:** usually SEV-3 — batch DAG failure affects **lakehouse freshness only**; operational
> systems (FHIR server, gateway, realtime sepsis path) are unaffected. **Exception:**
> `audit_worm_export` failure is SEV-2 (compliance — the WORM anchor is the audit chain's external
> root; see [audit-chain-broken](audit-chain-broken.md)).

## Symptoms

- Airflow UI (`:8080`) shows a red task / failed DAG run, or a task stuck in `up_for_retry`.
- Prometheus alert on `airflow_dag_run_failed` / DAG SLA miss.
- Superset dashboards or the cohort builder show stale data (OMOP not refreshed today).
- Downstream tasks `skipped` because an upstream task failed (expected fan-out).

## Diagnose

```bash
# 1. Which DAGs/tasks failed and when
docker compose ps airflow-scheduler airflow-webserver
docker compose logs --tail=200 airflow-scheduler | grep -iE "ERROR|failed|GreatExpectations|marked"

# 2. Inspect the failed run from the CLI (DAG_ID from the UI)
docker compose exec airflow-scheduler airflow dags list-runs -d bronze_to_silver --state failed
docker compose exec airflow-scheduler airflow tasks states-for-dag-run bronze_to_silver <RUN_ID>

# 3. Pull the failing task's full log (the real error is almost always here)
docker compose exec airflow-scheduler \
  airflow tasks logs bronze_to_silver validate_silver <RUN_ID> --try-number 1 \
  2>&1 | tail -120
```

Classify the failure:

```bash
# A. Great Expectations gate trip (data-quality failure, NOT an infra failure)
#    The task log shows "Expectation ... failed" / "Checkpoint result: success=False".
docker compose exec airflow-scheduler \
  airflow tasks logs bronze_to_silver validate_silver <RUN_ID> --try-number 1 \
  | grep -iE "expectation|unexpected_count|success: False"
# Inspect the GE result artifact (uncommitted docs) for the exact failing expectation:
docker compose exec airflow-scheduler \
  ls -t /opt/airflow/great_expectations/uncommitted/validations/ | head

# B. Upstream dependency down (Spark / MinIO / Kafka / Postgres)
docker compose ps spark-master spark-worker minio kafka postgres
docker compose logs --tail=80 spark-master | grep -iE "ERROR|lost|OutOfMemory"
curl -fsS http://localhost:9000/minio/health/ready && echo "minio ok"        # MinIO ready
docker compose exec postgres pg_isready -U medflow                            # Postgres ready

# C. Delta commit conflict / partial write (concurrent writer or prior crash)
docker compose exec airflow-scheduler \
  airflow tasks logs bronze_to_silver write_silver <RUN_ID> --try-number 1 \
  | grep -iE "ConcurrentAppend|metadata|_delta_log|ProtocolChanged"

# D. Kafka offset / source-empty issues (hl7_to_bronze, vitals_to_bronze)
docker compose exec kafka kafka-consumer-groups.sh --bootstrap-server localhost:9092 \
  --describe --group airflow-hl7-to-bronze   # check LAG and that offsets advanced
```

## Remediate

**GE gate trip (data quality — the gate did its job):** do **not** force the data through. The
silver/OMOP gate failing means bad data was *prevented* from propagating — operational systems are
fine. Identify the failing expectation, find the source rows, fix at source (mapping bug in the
ingester, bad simulator config), then clear and re-run from the offending task:

```bash
docker compose exec airflow-scheduler \
  airflow tasks clear bronze_to_silver -t validate_silver -s <DATE> -e <DATE> --yes
```

**Infra dependency down (Spark/MinIO/Kafka/Postgres):** restore the dependency, then clear and
re-run the failed task (DAGs are designed to be re-runnable; bronze loads bookmark Kafka offsets
in Delta, so re-runs are idempotent):

```bash
docker compose restart spark-master spark-worker     # example: Spark recovered
docker compose exec airflow-scheduler \
  airflow dags backfill -s <DATE> -e <DATE> bronze_to_silver
```

**Delta concurrent-write / partial commit:** Delta commits are atomic — there is **no partial
data** to clean up, only a failed transaction to retry. If a prior crash left an in-progress txn,
simply re-run; if `_delta_log` is genuinely corrupt, use time travel to read the last good version
and re-derive (see [restore-drill](restore-drill.md), logical-corruption path).

**`audit_worm_export` failure (SEV-2):** treat freshness as a compliance issue — the WORM bucket
is the audit chain's external anchor. Re-run promptly; if it cannot complete, escalate to the
compliance on-call and verify the chain still verifies in Postgres
([chain-verification.sql](../../compliance/audit-queries/chain-verification.sql)) so the gap is
bounded and documented.

## Escalate

- **GE gate keeps tripping after a source fix** → data-engineering owner of the failing DAG; the
  mapping or vocabulary mapping is wrong, not the data.
- **Spark OOM / repeated executor loss** → platform on-call; resize worker or fix a skewed join.
- **`silver_to_omop` referential-integrity failures** (orphan `person_id`) → data-engineering;
  likely a silver identity-resolution regression upstream.
- **`audit_worm_export` cannot complete** → **compliance on-call + security**, page per the
  [audit-chain-broken](audit-chain-broken.md) escalation path (the anchor being late narrows the
  tamper-detection window).

## Prevent

- GE gates are intentional fail-closed checkpoints — keep them strict; a tripped gate is a feature,
  not noise. Track gate-trip frequency to find upstream mapping rot early.
- Set/maintain Airflow SLAs and `airflow_dag_run_failed` Prometheus alerts so freshness regressions
  page before users notice stale dashboards.
- Keep DAGs idempotent and offset-bookmarked (already the design for bronze loads) so re-runs are
  always safe.
- OpenLineage → Marquez lets you trace a bad gold value back to the exact bronze partition and
  source topic; use it to localize root cause instead of guessing.
- Backstop: `vitals_to_bronze` re-derives bronze from Postgres `vitals` if streaming/bronze drift,
  so a batch failure is recoverable without data loss within Kafka's 7-day window.
