"""Service configuration via environment variables (see docker-compose.yml)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All values map 1:1 to the environment of the `dicom-receiver` compose service."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_name: str = "dicom-receiver"

    dicom_ae_title: str = "MEDFLOW"
    dicom_port: int = 11112
    http_port: int = 8091

    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str = "minio_admin"
    minio_secret_key: str = "minio_dev_password"
    imaging_bucket: str = "imaging"
    manifests_bucket: str = "manifests"
    manifest_key: str = "imaging.parquet"

    fhir_base_url: str = "http://fhir-server:8090/fhir"

    kafka_brokers: str = "kafka:9092"
    dicom_received_topic: str = "dicom.received"

    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
