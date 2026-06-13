"""Hourly ingest: ``fhir.changes`` Kafka topic → ``bronze/fhir_resources`` Delta.

Synthea-generated FHIR resources (and change events) published on
``fhir.changes`` are batch-loaded into the bronze layer, with the raw bundle
JSON additionally landed under ``s3://synthea-raw/bundles`` for replay.
A Great Expectations gate validates the table before the
``s3://lakehouse/bronze/fhir_resources`` Dataset event fires (which triggers
``bronze_to_silver``).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import (
    BRONZE_FHIR_PATH,
    DS_BRONZE_FHIR,
    SYNTHEA_RAW_BUNDLES_PATH,
)
from common.ge_checkpoint import make_ge_checkpoint_task
from common.medflow_spark import make_spark_submit_task

DOC_MD = """
### synthea_to_bronze

Kafka ``fhir.changes`` → Delta ``bronze/fhir_resources`` (idempotent MERGE on
Kafka coordinates) + raw bundle landing to ``s3://synthea-raw/bundles``.

* **Quality gate:** GE suite ``bronze_fhir`` must pass before the bronze FHIR
  Dataset event is emitted; downstream ``bronze_to_silver`` is data-aware.
* **Recovery:** re-runs and retries are safe — the loader MERGEs on
  ``(topic, partition, offset)`` and reads with a 25h lookback to cover gaps.
"""

with DAG(
    dag_id="synthea_to_bronze",
    description="Kafka fhir.changes -> Delta bronze/fhir_resources (+ raw landing)",
    schedule="@hourly",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=2)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "ingest", "bronze", "fhir", "synthea"],
    doc_md=DOC_MD,
) as dag:
    load_bronze = make_spark_submit_task(
        task_id="fhir_changes_to_bronze",
        application_file="kafka_to_bronze.py",
        application_args=[
            "--topic", "fhir.changes",
            "--payload-format", "fhir",
            "--table-path", BRONZE_FHIR_PATH,
            "--lookback-hours", "25",
            "--raw-landing-path", SYNTHEA_RAW_BUNDLES_PATH,
            "--run-id", "{{ run_id }}",
        ],
    )

    quality_gate = make_ge_checkpoint_task(
        task_id="ge_bronze_fhir",
        checkpoint_name="bronze",
        suite_name="bronze_fhir",
        table_path=BRONZE_FHIR_PATH,
        outlets=[DS_BRONZE_FHIR],
    )

    load_bronze >> quality_gate
