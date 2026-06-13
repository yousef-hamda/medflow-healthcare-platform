"""Environment-driven configuration for the sepsis-alerting Flink job.

All operational knobs (Kafka brokers, topics, ml-serving URL, thresholds,
checkpointing) are read from the environment with the MedFlow development
defaults baked in, so the job runs unconfigured against the local
``docker-compose`` stack and is fully overridable in other environments.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from sepsis_logic import (
    DEDUPE_WINDOW_SECONDS,
    RISING_EPSILON,
    SEPSIS_ALERT_THRESHOLD,
)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw not in (None, "") else default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw not in (None, "") else default


@dataclass(frozen=True)
class SepsisConfig:
    # Kafka
    bootstrap_servers: str = os.environ.get("MEDFLOW_KAFKA_BOOTSTRAP", "kafka:9092")
    source_topic: str = os.environ.get("MEDFLOW_VITALS_TOPIC", "vitals.raw")
    alerts_topic: str = os.environ.get("MEDFLOW_ALERTS_TOPIC", "alerts")
    aggregates_topic: str = os.environ.get(
        "MEDFLOW_AGGREGATES_TOPIC", "vitals.aggregates"
    )
    consumer_group: str = os.environ.get(
        "MEDFLOW_FLINK_GROUP", "medflow-sepsis-alerting"
    )

    # ml-serving
    serving_url: str = os.environ.get(
        "MEDFLOW_SEPSIS_SERVING_URL", "http://ml-serving:8094/predict/sepsis"
    )
    serving_timeout_seconds: float = _env_float("MEDFLOW_SEPSIS_SERVING_TIMEOUT", 1.5)

    # event-time / windowing
    watermark_out_of_orderness_ms: int = _env_int(
        "MEDFLOW_WATERMARK_MS", 2 * 60 * 1000
    )
    window_size_ms: int = _env_int("MEDFLOW_WINDOW_SIZE_MS", 6 * 60 * 60 * 1000)
    window_slide_ms: int = _env_int("MEDFLOW_WINDOW_SLIDE_MS", 15 * 60 * 1000)

    # alerting thresholds (shared with sepsis_logic)
    alert_threshold: float = _env_float(
        "MEDFLOW_SEPSIS_ALERT_THRESHOLD", SEPSIS_ALERT_THRESHOLD
    )
    dedupe_window_seconds: int = _env_int(
        "MEDFLOW_SEPSIS_DEDUPE_SECONDS", DEDUPE_WINDOW_SECONDS
    )
    rising_epsilon: float = _env_float("MEDFLOW_SEPSIS_RISING_EPSILON", RISING_EPSILON)

    # checkpointing (exactly-once)
    checkpoint_dir: str = os.environ.get(
        "MEDFLOW_FLINK_CHECKPOINT_DIR", "s3://lakehouse/_flink-checkpoints/sepsis"
    )
    checkpoint_interval_ms: int = _env_int("MEDFLOW_FLINK_CHECKPOINT_MS", 30 * 1000)
    checkpoint_timeout_ms: int = _env_int(
        "MEDFLOW_FLINK_CHECKPOINT_TIMEOUT_MS", 5 * 60 * 1000
    )

    parallelism: int = _env_int("MEDFLOW_FLINK_PARALLELISM", 2)


def get_config() -> SepsisConfig:
    return SepsisConfig()
