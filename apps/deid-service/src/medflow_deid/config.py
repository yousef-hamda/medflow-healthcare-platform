"""Service configuration via environment variables (see docker-compose.yml)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All values map 1:1 to the environment of the `deid-service` compose service."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    service_name: str = "deid-service"

    http_port: int = 8093

    audit_service_url: str = "http://audit-service:8095"
    audit_queue_size: int = 1000
    audit_retry_attempts: int = 3

    # Keyed secret for the deterministic per-patient date shift AND the
    # identifier pseudonyms (domain-separated internally; see engine/date_shift.py).
    date_shift_secret: str = "dev-only-date-shift-secret"

    log_level: str = "INFO"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
