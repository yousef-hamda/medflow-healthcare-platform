"""Factory for SparkSubmitOperator tasks pre-configured for the MedFlow stack.

Every Spark task submitted from Airflow needs the same boilerplate:

* Delta Lake session extensions and catalog,
* S3A wiring against the local MinIO (path-style, no TLS),
* the Kafka batch source package,
* UTC session timezone and a deterministic app name.

This module centralises that so DAGs only declare *what* job to run.

Connection
----------
The operator uses the Airflow connection ``spark_medflow`` (override with env
``MEDFLOW_SPARK_CONN_ID``). Create it once via:

    AIRFLOW_CONN_SPARK_MEDFLOW='spark://spark-master:7077?deploy-mode=client'

(e.g. added to the airflow services' environment) or through the UI.

Security note: MinIO credentials below are the documented development-only
defaults from docker-compose.yml; override via MEDFLOW_MINIO_* env vars.
Credentials are passed as Spark conf, never logged by this module.
"""
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Sequence

from airflow.providers.apache.spark.operators.spark_submit import SparkSubmitOperator

#: Where the Airflow containers see the PySpark job files (read-only mount of
#: ``data/airflow/dags`` per docker-compose.yml).
SPARK_JOBS_DIR: str = os.environ.get(
    "MEDFLOW_SPARK_JOBS_DIR", "/opt/airflow/dags/spark_jobs"
)

SPARK_CONN_ID: str = os.environ.get("MEDFLOW_SPARK_CONN_ID", "spark_medflow")

#: Maven coordinates resolved by spark-submit at launch (cached after first run).
DELTA_KAFKA_S3_PACKAGES: str = ",".join(
    [
        "io.delta:delta-spark_2.12:3.1.0",
        "org.apache.spark:spark-sql-kafka-0-10_2.12:3.5.1",
        "org.apache.hadoop:hadoop-aws:3.3.4",
    ]
)


def spark_job_path(filename: str) -> str:
    """Absolute path of a job script under ``spark_jobs/`` inside the container."""
    return f"{SPARK_JOBS_DIR}/{filename}"


def medflow_spark_conf(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Base Spark conf: Delta + S3A(MinIO) + Kafka package wiring."""
    conf: Dict[str, str] = {
        "spark.jars.packages": DELTA_KAFKA_S3_PACKAGES,
        # Delta Lake
        "spark.sql.extensions": "io.delta.sql.DeltaSparkSessionExtension",
        "spark.sql.catalog.spark_catalog": "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        "spark.databricks.delta.schema.autoMerge.enabled": "true",
        # MinIO via S3A
        "spark.hadoop.fs.s3a.endpoint": os.environ.get(
            "MEDFLOW_MINIO_ENDPOINT", "http://minio:9000"
        ),
        "spark.hadoop.fs.s3a.access.key": os.environ.get(
            "MEDFLOW_MINIO_ACCESS_KEY", "minio_admin"
        ),
        "spark.hadoop.fs.s3a.secret.key": os.environ.get(
            "MEDFLOW_MINIO_SECRET_KEY", "minio_dev_password"
        ),
        "spark.hadoop.fs.s3a.path.style.access": "true",
        "spark.hadoop.fs.s3a.connection.ssl.enabled": "false",
        "spark.hadoop.fs.s3a.impl": "org.apache.hadoop.fs.s3a.S3AFileSystem",
        "spark.hadoop.fs.s3a.aws.credentials.provider": (
            "org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider"
        ),
        # Determinism / hygiene
        "spark.sql.session.timeZone": "UTC",
        "spark.sql.shuffle.partitions": "8",
    }
    if extra:
        conf.update(extra)
    return conf


def make_spark_submit_task(
    *,
    task_id: str,
    application_file: str,
    application_args: Optional[Sequence[str]] = None,
    extra_conf: Optional[Dict[str, str]] = None,
    executor_memory: str = "1g",
    driver_memory: str = "1g",
    **operator_kwargs: Any,
) -> SparkSubmitOperator:
    """Build a :class:`SparkSubmitOperator` against ``spark://spark-master:7077``.

    Parameters
    ----------
    task_id:
        Airflow task id; also used for the Spark application name.
    application_file:
        Filename under ``spark_jobs/`` (e.g. ``"kafka_to_bronze.py"``).
    application_args:
        CLI args forwarded to the job's argparse interface.
    extra_conf:
        Job-specific Spark conf overrides merged on top of the MedFlow base conf.
    operator_kwargs:
        Any further BaseOperator kwargs (``outlets``, ``sla``, ``dag``, ...).
    """
    args: List[str] = list(application_args or [])
    return SparkSubmitOperator(
        task_id=task_id,
        conn_id=SPARK_CONN_ID,
        application=spark_job_path(application_file),
        application_args=args,
        name=f"medflow-{task_id}",
        conf=medflow_spark_conf(extra_conf),
        executor_memory=executor_memory,
        driver_memory=driver_memory,
        verbose=False,
        **operator_kwargs,
    )
