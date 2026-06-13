"""Nightly offline feature backfill + data-drift report.

Once the gold OMOP layer is fresh, this DAG rebuilds the offline feature store
(``medflow_ml.jobs.backfill_features`` — vitals stats, encounter history, lab
flags, then a Feast materialize) and produces an Evidently data-drift report
(``medflow_ml.jobs.drift_report --model sepsis``) comparing the latest scoring
window against the training baseline.

Both steps are plain ``BashOperator`` calls into the installed ``medflow_ml``
package so the heavy Spark/Feast logic stays out of the scheduler. The DAG runs
on a nightly cron; the gold OMOP Dataset is declared as an input so the lineage
graph still records the gold → features edge.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.timetables.datasets import DatasetOrTimeSchedule
from airflow.timetables.trigger import CronTriggerTimetable

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import DS_FEATURES, DS_GOLD_OMOP

DOC_MD = """
### feature_backfill

Nightly rebuild of the offline feature store and a data-drift report.

* **Scheduling:** nightly cron ``0 2 * * *`` *and* data-aware on the gold OMOP
  Dataset (``DatasetOrTimeSchedule``), so a late OMOP build is still picked up
  the same night.
* **backfill_features:** ``python -m medflow_ml.jobs.backfill_features`` builds
  vitals/encounter/lab features from gold and Feast-materializes them; emits the
  ``s3://lakehouse/features/sepsis`` Dataset on success.
* **drift_report:** ``python -m medflow_ml.jobs.drift_report --model sepsis``
  writes an Evidently HTML report (current scoring window vs training baseline).
* **Recovery:** both jobs are idempotent (full recompute of the window); the
  drift report runs only after a successful backfill.
"""

with DAG(
    dag_id="feature_backfill",
    description="Nightly offline feature backfill (Feast) + Evidently drift report",
    schedule=DatasetOrTimeSchedule(
        timetable=CronTriggerTimetable("0 2 * * *", timezone="UTC"),
        datasets=[DS_GOLD_OMOP],
    ),
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=3)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "ml", "features", "feast", "drift"],
    doc_md=DOC_MD,
) as dag:
    backfill = BashOperator(
        task_id="backfill_features",
        bash_command="python -m medflow_ml.jobs.backfill_features",
        outlets=[DS_FEATURES],
    )

    drift = BashOperator(
        task_id="drift_report_sepsis",
        bash_command="python -m medflow_ml.jobs.drift_report --model sepsis",
    )

    backfill >> drift
