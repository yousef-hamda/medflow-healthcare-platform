"""Batch-job configuration via environment (pydantic-settings v2).

Mirrors the platform contract: MLflow registry, MinIO-backed lakehouse,
Feast online store and the Spark master defined in docker-compose.yml.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. Values come from the environment."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # MLflow tracking + model registry
    mlflow_tracking_uri: str = Field(default="http://mlflow:5000", alias="MLFLOW_TRACKING_URI")
    mlflow_s3_endpoint_url: str = Field(
        default="http://minio:9000", alias="MLFLOW_S3_ENDPOINT_URL"
    )

    # MinIO / S3 (lakehouse + drift-report buckets)
    s3_endpoint_url: str = Field(default="http://minio:9000", alias="S3_ENDPOINT_URL")
    aws_access_key_id: str = Field(default="minio_admin", alias="AWS_ACCESS_KEY_ID")
    aws_secret_access_key: str = Field(default="minio_dev_password", alias="AWS_SECRET_ACCESS_KEY")
    aws_region: str = Field(default="us-east-1", alias="AWS_REGION")

    # Delta lakehouse layout
    lakehouse_bucket: str = Field(default="lakehouse", alias="LAKEHOUSE_BUCKET")
    gold_prefix: str = Field(default="gold", alias="GOLD_PREFIX")
    feature_store_prefix: str = Field(default="feature_store", alias="FEATURE_STORE_PREFIX")
    drift_reports_bucket: str = Field(default="drift-reports", alias="DRIFT_REPORTS_BUCKET")

    # Spark
    spark_master: str = Field(default="spark://spark-master:7077", alias="SPARK_MASTER")
    spark_app_name: str = Field(default="medflow-ml", alias="SPARK_APP_NAME")
    spark_driver_memory: str = Field(default="2g", alias="SPARK_DRIVER_MEMORY")
    spark_executor_memory: str = Field(default="4g", alias="SPARK_EXECUTOR_MEMORY")

    # Feast
    feast_repo_path: str = Field(default="/workspace/ml/feature_repo", alias="FEAST_REPO_PATH")
    feast_redis_host: str = Field(default="redis", alias="FEAST_REDIS_HOST")
    feast_redis_port: int = Field(default=6379, alias="FEAST_REDIS_PORT")

    # Predictions log (read-only for drift jobs)
    predictions_database_url: str = Field(
        default="postgresql+psycopg2://medflow:medflow_dev_password@postgres:5432/predictions",
        alias="PREDICTIONS_DATABASE_URL",
    )

    # NIH ChestX-ray14 local mirror (research use only)
    chestxray_dir: str = Field(default="/data/chestxray14", alias="CHESTXRAY_DIR")

    # Registered model names (must match serving)
    sepsis_model_name: str = Field(default="sepsis-ews", alias="SEPSIS_MODEL_NAME")
    readmission_model_name: str = Field(default="readmission-30d", alias="READMISSION_MODEL_NAME")
    xray_model_name: str = Field(default="chest-xray-14", alias="XRAY_MODEL_NAME")

    # Reproducibility
    random_seed: int = Field(default=42, alias="RANDOM_SEED")

    def gold_table_uri(self, table: str) -> str:
        """s3 URI of a gold Delta table, e.g. ``s3://lakehouse/gold/measurement``."""
        return f"s3://{self.lakehouse_bucket}/{self.gold_prefix}/{table}"

    def gold_table_s3a(self, table: str) -> str:
        """s3a URI of a gold Delta table for Spark reads/writes."""
        return f"s3a://{self.lakehouse_bucket}/{self.gold_prefix}/{table}"

    def feature_store_uri(self, name: str) -> str:
        """s3 URI of an offline-store parquet dataset."""
        return f"s3://{self.lakehouse_bucket}/{self.feature_store_prefix}/{name}.parquet"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
