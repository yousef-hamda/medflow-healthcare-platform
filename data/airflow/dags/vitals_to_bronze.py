"""Hourly ingest: ``vitals.raw`` Kafka topic → ``bronze/vitals_raw`` Delta.

Bedside-device vitals JSON is batch-loaded with the numeric vitals (heart
rate, respiratory rate, blood pressures, SpO2, temperature) lifted into typed
columns so the ``bronze_vitals`` GE suite can range-check physiological
plausibility (HR 20–300, SpO2 50–100, ...).

Note: real-time sepsis alerting on the same topic is handled by the Flink job
(``data/flink/sepsis_alerting.py``); this DAG only persists the lakehouse copy.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import BRONZE_VITALS_PATH, DS_BRONZE_VITALS
from common.ge_checkpoint import make_ge_checkpoint_task
from common.medflow_spark import make_spark_submit_task

DOC_MD = """
### vitals_to_bronze

Kafka ``vitals.raw`` → Delta ``bronze/vitals_raw``.

* Numeric vitals extracted into typed columns for GE range checks
  (suite ``bronze_vitals``: HR 20–300, SpO2 50–100, RR 4–80, T 30–43 °C,
  SBP 40–300).
* Idempotent: MERGE on Kafka ``(topic, partition, offset)``; 25h lookback.
"""

with DAG(
    dag_id="vitals_to_bronze",
    description="Kafka vitals.raw -> Delta bronze/vitals_raw",
    schedule="@hourly",
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=2)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "ingest", "bronze", "vitals", "iot"],
    doc_md=DOC_MD,
) as dag:
    load_bronze = make_spark_submit_task(
        task_id="vitals_raw_to_bronze",
        application_file="kafka_to_bronze.py",
        application_args=[
            "--topic", "vitals.raw",
            "--payload-format", "vitals",
            "--table-path", BRONZE_VITALS_PATH,
            "--lookback-hours", "25",
            "--run-id", "{{ run_id }}",
        ],
    )

    quality_gate = make_ge_checkpoint_task(
        task_id="ge_bronze_vitals",
        checkpoint_name="bronze",
        suite_name="bronze_vitals",
        table_path=BRONZE_VITALS_PATH,
        outlets=[DS_BRONZE_VITALS],
    )

    load_bronze >> quality_gate
