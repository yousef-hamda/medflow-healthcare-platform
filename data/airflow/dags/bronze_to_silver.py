"""Bronze → Silver flattening, fan-out per entity, dataset-aware scheduling.

Triggered whenever any upstream bronze ``Dataset`` updates (the ingest DAGs'
GE gates emit those events). Each FHIR/DICOM entity is flattened by an
independent ``spark_jobs/bronze_to_silver.py`` task, and clinical notes are
de-identified through the deid-service by ``spark_jobs/notes_deid.py``. Every
silver task is immediately followed by a Great Expectations checkpoint
(``common/ge_checkpoint``) acting as a hard quality gate; only on a passing gate
does the corresponding silver ``Dataset`` event fire, which in turn makes
``silver_to_omop`` runnable.

Entities are mutually independent, so the per-entity ``flatten → validate``
chains run in parallel.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from airflow import DAG

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import (
    BRONZE_DICOM_PATH,
    BRONZE_FHIR_PATH,
    DS_BRONZE_DICOM,
    DS_BRONZE_FHIR,
    DS_SILVER_ENCOUNTERS,
    DS_SILVER_IMAGING,
    DS_SILVER_MEDICATIONS,
    DS_SILVER_NOTES_DEID,
    DS_SILVER_OBSERVATIONS,
    DS_SILVER_PATIENTS,
    SILVER_ENCOUNTERS_PATH,
    SILVER_IMAGING_PATH,
    SILVER_MEDICATIONS_PATH,
    SILVER_NOTES_DEID_PATH,
    SILVER_OBSERVATIONS_PATH,
    SILVER_PATIENTS_PATH,
)
from common.ge_checkpoint import make_ge_checkpoint_task
from common.medflow_spark import make_spark_submit_task

DOC_MD = """
### bronze_to_silver

Fan-out flattening of the bronze layer into typed, deduplicated silver Delta
tables, then de-identification of clinical notes.

* **Scheduling:** data-aware — runs when any of the bronze FHIR / DICOM
  Datasets update (emitted by the ingest DAGs' GE gates).
* **Per entity:** ``spark_jobs/bronze_to_silver.py --entity <e>`` (idempotent
  MERGE on the natural key) → GE checkpoint (suite ``silver_<e>``) →
  silver Dataset event.
* **Notes:** ``spark_jobs/notes_deid.py`` POSTs every note to the deid-service;
  raw text never reaches silver. A GE gate guards ``silver/notes_deid``.
* **Hard gates:** a failing checkpoint blocks the silver Dataset event, so
  ``silver_to_omop`` will not run on bad data.
* **Recovery:** every task is idempotent (MERGE upserts); retries and manual
  re-triggers are safe.
"""

# entity → (bronze source path, silver target path, GE silver suite, outlet)
FHIR_ENTITIES = [
    ("patients", BRONZE_FHIR_PATH, SILVER_PATIENTS_PATH, "silver_patients", DS_SILVER_PATIENTS),
    ("encounters", BRONZE_FHIR_PATH, SILVER_ENCOUNTERS_PATH, "silver_encounters", DS_SILVER_ENCOUNTERS),
    ("observations", BRONZE_FHIR_PATH, SILVER_OBSERVATIONS_PATH, "silver_observations", DS_SILVER_OBSERVATIONS),
    ("medications", BRONZE_FHIR_PATH, SILVER_MEDICATIONS_PATH, "silver_medications", DS_SILVER_MEDICATIONS),
    ("imaging_studies", BRONZE_DICOM_PATH, SILVER_IMAGING_PATH, "silver_imaging_studies", DS_SILVER_IMAGING),
]

with DAG(
    dag_id="bronze_to_silver",
    description="Flatten + dedupe bronze -> silver Delta tables, de-id notes (GE-gated)",
    schedule=[DS_BRONZE_FHIR, DS_BRONZE_DICOM],
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=3)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "transform", "silver", "great-expectations"],
    doc_md=DOC_MD,
) as dag:
    for entity, source_path, target_path, suite, outlet in FHIR_ENTITIES:
        flatten = make_spark_submit_task(
            task_id=f"silver_{entity}",
            application_file="bronze_to_silver.py",
            application_args=[
                "--entity", entity,
                "--source-path", source_path,
                "--target-path", target_path,
                "--run-id", "{{ run_id }}",
            ],
        )
        validate = make_ge_checkpoint_task(
            task_id=f"ge_{suite}",
            checkpoint_name="silver",
            suite_name=suite,
            table_path=target_path,
            outlets=[outlet],
        )
        flatten >> validate

    deid_notes = make_spark_submit_task(
        task_id="silver_notes_deid",
        application_file="notes_deid.py",
        application_args=[
            "--source-path", BRONZE_FHIR_PATH,
            "--target-path", SILVER_NOTES_DEID_PATH,
            "--run-id", "{{ run_id }}",
        ],
    )
    validate_notes = make_ge_checkpoint_task(
        task_id="ge_silver_notes_deid",
        checkpoint_name="silver",
        suite_name="silver_notes_deid",
        table_path=SILVER_NOTES_DEID_PATH,
        outlets=[DS_SILVER_NOTES_DEID],
    )
    deid_notes >> validate_notes
