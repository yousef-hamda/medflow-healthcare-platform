"""Hourly ingest: ``hl7.raw`` Kafka topic → ``bronze/hl7_messages`` Delta.

Raw HL7v2 messages (ADT/ORU/ORM feeds relayed from the MLLP listener) are
batch-loaded with their MSH-9 message type and MSH-10 control id extracted.
A Great Expectations gate validates the table before the bronze HL7 Dataset
event fires.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import BRONZE_HL7_PATH, DS_BRONZE_HL7
from common.ge_checkpoint import make_ge_checkpoint_task
from common.medflow_spark import make_spark_submit_task

DOC_MD = """
### hl7_to_bronze

Kafka ``hl7.raw`` → Delta ``bronze/hl7_messages``.

* MSH-9 (message type) and MSH-10 (control id) are lifted into columns so the
  GE suite ``bronze_hl7`` can assert HL7 envelope integrity.
* Idempotent: MERGE on Kafka ``(topic, partition, offset)``; 25h lookback.
"""

with DAG(
    dag_id="hl7_to_bronze",
    description="Kafka hl7.raw -> Delta bronze/hl7_messages",
    schedule="@hourly",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=2)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "ingest", "bronze", "hl7"],
    doc_md=DOC_MD,
) as dag:
    load_bronze = make_spark_submit_task(
        task_id="hl7_raw_to_bronze",
        application_file="kafka_to_bronze.py",
        application_args=[
            "--topic", "hl7.raw",
            "--payload-format", "hl7",
            "--table-path", BRONZE_HL7_PATH,
            "--lookback-hours", "25",
            "--run-id", "{{ run_id }}",
        ],
    )

    quality_gate = make_ge_checkpoint_task(
        task_id="ge_bronze_hl7",
        checkpoint_name="bronze",
        suite_name="bronze_hl7",
        table_path=BRONZE_HL7_PATH,
        outlets=[DS_BRONZE_HL7],
    )

    load_bronze >> quality_gate
