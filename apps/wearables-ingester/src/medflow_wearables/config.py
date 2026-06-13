"""Service configuration via environment variables (see docker-compose.yml)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_name: str = "wearables-ingester"

    http_port: int = 8092
    mqtt_broker: str = "mosquitto"
    mqtt_port: int = 1883
    mqtt_topic_filter: str = "vitals/+"

    database_url: str = "postgresql+asyncpg://medflow:medflow_dev_password@postgres:5432/vitals"

    kafka_brokers: str = "kafka:9092"
    vitals_raw_topic: str = "vitals.raw"

    dedup_cache_size: int = 100_000
    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
