"""Spark session + S3A/Delta configuration for distributed gold-table jobs.

PySpark and delta-spark are imported lazily so that the pure feature/eval
modules (and unit tests) never need a JVM. Use this for ``s3a://`` Delta
reads/writes; for pandas-scale ``s3://`` paths prefer :mod:`delta_io`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from medflow_ml.config import Settings, get_settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    from pyspark.sql import DataFrame, SparkSession


def build_spark_conf(settings: Settings | None = None) -> dict[str, str]:
    """Return the Spark/Delta/S3A config dict for a gold-lakehouse session.

    Pure (no Spark import) so the exact keys can be asserted in tests.
    """
    cfg = settings or get_settings()
    endpoint = cfg.s3_endpoint_url
    return {
        "spark.app.name": cfg.spark_app_name,
        "spark.sql.extensions": "io.delta.sql.DeltaSparkSessionExtension",
        "spark.sql.catalog.spark_catalog": "org.apache.spark.sql.delta.catalog.DeltaCatalog",
        "spark.jars.packages": "io.delta:delta-spark_2.12:3.2.0,org.apache.hadoop:hadoop-aws:3.3.4",
        "spark.hadoop.fs.s3a.endpoint": endpoint,
        "spark.hadoop.fs.s3a.access.key": cfg.aws_access_key_id,
        "spark.hadoop.fs.s3a.secret.key": cfg.aws_secret_access_key,
        "spark.hadoop.fs.s3a.path.style.access": "true",
        "spark.hadoop.fs.s3a.connection.ssl.enabled": str(endpoint.startswith("https")).lower(),
        "spark.hadoop.fs.s3a.impl": "org.apache.hadoop.fs.s3a.S3AFileSystem",
        "spark.hadoop.fs.s3a.aws.credentials.provider": (
            "org.apache.hadoop.fs.s3a.SimpleAWSCredentialsProvider"
        ),
        "spark.sql.session.timeZone": "UTC",
        "spark.driver.memory": cfg.spark_driver_memory,
        "spark.executor.memory": cfg.spark_executor_memory,
    }


def get_spark(
    settings: Settings | None = None, master: str | None = None
) -> SparkSession:
    """Build (or get) a Spark session wired for the Delta gold lakehouse."""
    from pyspark.sql import SparkSession  # noqa: PLC0415

    cfg = settings or get_settings()
    builder = SparkSession.builder.master(master or cfg.spark_master)  # type: ignore[attr-defined]
    for key, value in build_spark_conf(cfg).items():
        builder = builder.config(key, value)
    return builder.getOrCreate()


def read_delta_spark(spark: Any, table_uri: str) -> DataFrame:
    """Read a Delta table by ``s3a://`` URI into a Spark DataFrame."""
    return spark.read.format("delta").load(table_uri)


def write_delta_spark(
    df: Any, table_uri: str, mode: str = "overwrite", partition_by: list[str] | None = None
) -> None:
    """Write a Spark DataFrame as a Delta table to ``s3a://`` URI."""
    writer = df.write.format("delta").mode(mode)
    if partition_by:
        writer = writer.partitionBy(*partition_by)
    writer.save(table_uri)


def stop_spark(spark: Any) -> None:
    """Stop a Spark session if it is running (idempotent)."""
    if spark is not None:
        spark.stop()
