"""Silver → Gold OMOP CDM v5.4 via dbt-spark, then GE gates on the gold marts.

Triggered when the core silver Datasets update (emitted by ``bronze_to_silver``
GE gates). The OMOP transform is owned by the dbt project at ``data/dbt``
(``medflow_omop``): a single ``dbt build`` runs every staging + mart model and
dbt's own ``schema.yml`` tests. dbt is invoked through a ``BashOperator`` (the
dbt-spark adapter talks to the Spark Thrift server).

After dbt succeeds, Great Expectations checkpoints validate the two highest-risk
gold tables (``gold/person`` and ``gold/measurement``) as an independent, hard
quality gate before the gold OMOP Dataset event fires — which is what
``feature_backfill`` and the downstream ML/analytics consumers are scheduled on.

OpenLineage emits run events for every operator automatically (the
``apache-airflow-providers-openlineage`` provider is configured against
``http://marquez:5001`` namespace ``medflow``); a final no-op marker task makes
the OMOP-build completion explicit in the lineage graph.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from airflow import DAG
from airflow.operators.bash import BashOperator
from airflow.operators.empty import EmptyOperator

from common.alerting import medflow_default_args, sla_miss_callback
from common.datasets import (
    DS_GOLD_OMOP,
    DS_SILVER_ENCOUNTERS,
    DS_SILVER_MEDICATIONS,
    DS_SILVER_NOTES_DEID,
    DS_SILVER_OBSERVATIONS,
    DS_SILVER_PATIENTS,
    GOLD_MEASUREMENT_PATH,
    GOLD_PERSON_PATH,
)
from common.ge_checkpoint import make_ge_checkpoint_task

#: Where the Airflow containers see the dbt project (read-only mount of data/dbt).
DBT_PROJECT_DIR: str = os.environ.get("MEDFLOW_DBT_PROJECT_DIR", "/opt/airflow/dbt")
DBT_PROFILES_DIR: str = os.environ.get("MEDFLOW_DBT_PROFILES_DIR", "/opt/airflow/dbt")
DBT_TARGET: str = os.environ.get("MEDFLOW_DBT_TARGET", "spark")

DOC_MD = """
### silver_to_omop

Build the OMOP CDM v5.4 gold layer from silver using **dbt-spark**
(project ``data/dbt`` / ``medflow_omop``), then validate the marts with
Great Expectations.

* **Scheduling:** data-aware on the core silver Datasets
  (patients, encounters, observations, medications, notes).
* **Transform:** ``dbt build`` runs staging + OMOP mart models
  (person, visit_occurrence, condition_occurrence, drug_exposure, measurement,
  observation, procedure_occurrence, note, note_nlp) and dbt's schema tests.
  Standard vocabulary concept ids come from the seed concept maps.
* **Gold gates:** GE checkpoints on ``gold/person`` and ``gold/measurement``
  (gender_concept_id ∈ {8507,8532,0}, year_of_birth bounds, measurement value
  sanity + non-null concept ids) before the gold OMOP Dataset event fires.
* **Lineage:** the OpenLineage provider emits start/complete events for every
  task to Marquez (namespace ``medflow``).
* **Recovery:** dbt models are idempotent (full refresh of marts); GE gates are
  hard gates that block the Dataset event on failure.
"""

with DAG(
    dag_id="silver_to_omop",
    description="dbt-spark build silver -> OMOP CDM v5.4 gold (GE-gated, OpenLineage)",
    schedule=[
        DS_SILVER_PATIENTS,
        DS_SILVER_ENCOUNTERS,
        DS_SILVER_OBSERVATIONS,
        DS_SILVER_MEDICATIONS,
        DS_SILVER_NOTES_DEID,
    ],
    start_date=datetime(2026, 1, 1),
    catchup=False,
    max_active_runs=1,
    default_args=medflow_default_args(sla=timedelta(hours=4)),
    sla_miss_callback=sla_miss_callback,
    tags=["medflow", "transform", "gold", "omop", "dbt"],
    doc_md=DOC_MD,
) as dag:
    dbt_build = BashOperator(
        task_id="dbt_build_omop",
        bash_command=(
            "cd {{ params.project_dir }} && "
            "dbt build "
            "--project-dir {{ params.project_dir }} "
            "--profiles-dir {{ params.profiles_dir }} "
            "--target {{ params.target }} "
            "--vars '{run_id: {{ run_id }}}'"
        ),
        params={
            "project_dir": DBT_PROJECT_DIR,
            "profiles_dir": DBT_PROFILES_DIR,
            "target": DBT_TARGET,
        },
        env={
            "DBT_SPARK_HOST": os.environ.get("MEDFLOW_SPARK_THRIFT_HOST", "spark-master"),
            "DBT_SPARK_PORT": os.environ.get("MEDFLOW_SPARK_THRIFT_PORT", "10000"),
        },
        append_env=True,
    )

    ge_person = make_ge_checkpoint_task(
        task_id="ge_gold_person",
        checkpoint_name="gold",
        suite_name="gold_person",
        table_path=GOLD_PERSON_PATH,
    )
    ge_measurement = make_ge_checkpoint_task(
        task_id="ge_gold_measurement",
        checkpoint_name="gold",
        suite_name="gold_measurement",
        table_path=GOLD_MEASUREMENT_PATH,
        outlets=[DS_GOLD_OMOP],
    )

    omop_ready = EmptyOperator(
        task_id="omop_build_complete",
        doc_md="OpenLineage completion marker for the OMOP gold build.",
    )

    dbt_build >> [ge_person, ge_measurement] >> omop_ready
