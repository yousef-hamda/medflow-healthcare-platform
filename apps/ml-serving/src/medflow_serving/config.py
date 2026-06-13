"""Service configuration via environment (pydantic-settings v2).

Mirrors the env contract defined in docker-compose.yml for the
`ml-serving` service.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All runtime configuration. Values come from the environment."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    http_port: int = Field(default=8094, alias="HTTP_PORT")

    # MLflow model registry
    mlflow_tracking_uri: str = Field(default="http://mlflow:5000", alias="MLFLOW_TRACKING_URI")
    mlflow_s3_endpoint_url: str = Field(
        default="http://minio:9000", alias="MLFLOW_S3_ENDPOINT_URL"
    )

    # Feast online store
    feast_redis_host: str = Field(default="redis", alias="FEAST_REDIS_HOST")
    feast_redis_port: int = Field(default=6379, alias="FEAST_REDIS_PORT")

    # Append-only predictions log
    database_url: str = Field(
        default="postgresql+asyncpg://medflow:medflow_dev_password@postgres:5432/predictions",
        alias="DATABASE_URL",
    )
    kafka_brokers: str = Field(default="kafka:9092", alias="KAFKA_BROKERS")
    predictions_topic: str = Field(default="predictions", alias="PREDICTIONS_TOPIC")

    # Canary routing
    canary_enabled: bool = Field(default=False, alias="CANARY_ENABLED")
    canary_model_version: str | None = Field(default=None, alias="CANARY_MODEL_VERSION")
    canary_percent: int = Field(default=10, ge=0, le=100, alias="CANARY_PERCENT")

    # Salt for one-way patient id hashing in logs / persistence. Never log raw ids.
    hash_salt: str = Field(default="medflow-dev-hash-salt", alias="HASH_SALT")

    # Model registry names (MLflow registered model names)
    sepsis_model_name: str = Field(default="sepsis-ews", alias="SEPSIS_MODEL_NAME")
    readmission_model_name: str = Field(default="readmission-30d", alias="READMISSION_MODEL_NAME")
    xray_model_name: str = Field(default="chest-xray-14", alias="XRAY_MODEL_NAME")
    model_stage: str = Field(default="Production", alias="MODEL_STAGE")

    # When MLflow has no registered model yet, serve documented rule-based
    # fallback scores instead of failing, so `make dev` works pre-training.
    cold_start_enabled: bool = Field(default=True, alias="COLD_START_ENABLED")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
