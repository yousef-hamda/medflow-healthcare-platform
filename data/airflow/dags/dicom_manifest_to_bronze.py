"""Hourly ingest: ``dicom.received`` Kafka topic → ``bronze/dicom_metadata`` Delta.

When the imaging gateway finishes storing a DICOM study it publishes a
manifest (study/series counts, modality, storage path — *metadata only*, no
pixel data) on ``dicom.received``. This DAG persists those manifests to
bronze; ``bronze_to_silver`` flattens them into ``silver/imaging_studies``.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import BRONZE_DICOM_PATH, DS_BRONZE_DICOM
from common.ge_checkpoint import make_ge_checkpoint_task
from common.medflow_spark import make_spark_submit_task

DOC_MD = """
### dicom_manifest_to_bronze

Kafka ``dicom.received`` → Delta ``bronze/dicom_metadata``.

* Manifests carry pointers to object storage, never pixel data.
* GE suite ``bronze_dicom`` asserts study UID / modality integrity before the
  bronze DICOM Dataset event fires.
* Idempotent: MERGE on Kafka ``(topic, partition, offset)``; 25h lookback.
"""

with DAG(
    dag_id="dicom_manifest_to_bronze",
    description="Kafka dicom.received -> Delta bronze/dicom_metadata",
    schedule="@hourly",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=2)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "ingest", "bronze", "dicom", "imaging"],
    doc_md=DOC_MD,
) as dag:
    load_bronze = make_spark_submit_task(
        task_id="dicom_received_to_bronze",
        application_file="kafka_to_bronze.py",
        application_args=[
            "--topic", "dicom.received",
            "--payload-format", "dicom",
            "--table-path", BRONZE_DICOM_PATH,
            "--lookback-hours", "25",
            "--run-id", "{{ run_id }}",
        ],
    )

    quality_gate = make_ge_checkpoint_task(
        task_id="ge_bronze_dicom",
        checkpoint_name="bronze",
        suite_name="bronze_dicom",
        table_path=BRONZE_DICOM_PATH,
        outlets=[DS_BRONZE_DICOM],
    )

    load_bronze >> quality_gate
