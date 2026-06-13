"""PythonOperator wrapper that runs a Great Expectations checkpoint.

Pattern
-------
The GE project lives at ``/opt/airflow/great_expectations`` (read-only mount of
``data/great_expectations``). Checkpoints there are declared *without* a static
batch: this wrapper builds a ``RuntimeBatchRequest`` at execution time by

1. starting a small **local** Spark session on the Airflow worker (pyspark is
   pulled in by the Spark provider; Delta/S3A jars resolve via
   ``spark.jars.packages``),
2. reading the Delta table that the upstream task just wrote,
3. handing the DataFrame to the checkpoint via ``runtime_parameters``.

On any failed expectation the task raises ``AirflowException`` so every
downstream task is blocked — quality gates are hard gates.

Validation results and data docs are written to a writable scratch directory
(``/tmp/medflow_ge``) because the project mount is read-only.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Optional

from airflow.exceptions import AirflowException
from airflow.operators.python import PythonOperator

log = logging.getLogger("medflow.ge")

GE_ROOT: str = os.environ.get(
    "MEDFLOW_GE_ROOT", "/opt/airflow/great_expectations"
)
GE_DATASOURCE = "medflow_spark"
GE_DATA_CONNECTOR = "medflow_runtime"

# Delta + S3A jars for the local validation session (same pins as medflow_spark).
_GE_SPARK_PACKAGES = ",".join(
    [
        "io.delta:delta-spark_2.12:3.1.0",
        "org.apache.hadoop:hadoop-aws:3.3.4",
    ]
)


def _local_spark_session() -> Any:
    """A local[2] Spark session able to read Delta tables from MinIO."""
    from pyspark.sql import SparkSession

    builder = (
        SparkSession.builder.appName("medflow-ge-validation")
        .master(os.environ.get("MEDFLOW_GE_SPARK_MASTER", "local[2]"))
        .config("spark.jars.packages", _GE_SPARK_PACKAGES)
        .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension")
        .config(
            "spark.sql.catalog.spark_catalog",
            "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        )
        .config(
            "spark.hadoop.fs.s3a.endpoint",
            os.environ.get("MEDFLOW_MINIO_ENDPOINT", "http://minio:9000"),
        )
        .config(
            "spark.hadoop.fs.s3a.access.key",
            os.environ.get("MEDFLOW_MINIO_ACCESS_KEY", "minio_admin"),
        )
        .config(
            "spark.hadoop.fs.s3a.secret.key",
            os.environ.get("MEDFLOW_MINIO_SECRET_KEY", "minio_dev_password"),
        )
        .config("spark.hadoop.fs.s3a.path.style.access", "true")
        .config("spark.hadoop.fs.s3a.connection.ssl.enabled", "false")
        .config("spark.sql.session.timeZone", "UTC")
    )
    return builder.getOrCreate()


def run_ge_checkpoint(
    checkpoint_name: str,
    suite_name: str,
    table_path: str,
    asset_name: str,
    **context: Any,
) -> None:
    """Validate a Delta table against an expectation suite via a checkpoint.

    Raises
    ------
    AirflowException
        If the table cannot be read or any expectation in the suite fails,
        blocking all downstream tasks.
    """
    import great_expectations as gx
    from great_expectations.core.batch import RuntimeBatchRequest

    run_id = str(context.get("run_id", "manual"))
    log.info(
        "MEDFLOW_GE %s",
        json.dumps(
            {
                "event": "checkpoint_start",
                "checkpoint": checkpoint_name,
                "suite": suite_name,
                "asset": asset_name,
                "run_id": run_id,
            }
        ),
    )

    spark = _local_spark_session()
    try:
        df = spark.read.format("delta").load(table_path)
    except Exception as exc:  # noqa: BLE001 - surface as a quality-gate failure
        raise AirflowException(
            f"GE checkpoint {checkpoint_name}: cannot read Delta table at "
            f"{table_path}: {exc}"
        ) from exc

    ge_context = gx.get_context(context_root_dir=GE_ROOT)
    batch_request = RuntimeBatchRequest(
        datasource_name=GE_DATASOURCE,
        data_connector_name=GE_DATA_CONNECTOR,
        data_asset_name=asset_name,
        runtime_parameters={"batch_data": df},
        batch_identifiers={"run_id": run_id},
    )
    result = ge_context.run_checkpoint(
        checkpoint_name=checkpoint_name,
        validations=[
            {
                "batch_request": batch_request,
                "expectation_suite_name": suite_name,
            }
        ],
    )

    stats = {"event": "checkpoint_done", "checkpoint": checkpoint_name, "success": bool(result["success"])}
    log.info("MEDFLOW_GE %s", json.dumps(stats))
    if not result["success"]:
        # Log expectation *names* only; observed values may quote row data.
        failed = [
            exp_result.expectation_config.expectation_type
            for run in result.run_results.values()
            for exp_result in run["validation_result"].results
            if not exp_result.success
        ]
        raise AirflowException(
            f"GE checkpoint {checkpoint_name} failed expectations: {failed}"
        )


def make_ge_checkpoint_task(
    *,
    task_id: str,
    checkpoint_name: str,
    suite_name: str,
    table_path: str,
    asset_name: Optional[str] = None,
    **operator_kwargs: Any,
) -> PythonOperator:
    """Factory: PythonOperator running ``run_ge_checkpoint`` for one table."""
    return PythonOperator(
        task_id=task_id,
        python_callable=run_ge_checkpoint,
        op_kwargs={
            "checkpoint_name": checkpoint_name,
            "suite_name": suite_name,
            "table_path": table_path,
            "asset_name": asset_name or suite_name,
        },
        **operator_kwargs,
    )
