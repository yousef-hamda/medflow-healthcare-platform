"""confluent-kafka producer for the ``vitals.raw`` topic.

confluent-kafka is a synchronous C client; ``publish`` stays async-friendly by
pushing the (non-blocking, but potentially briefly buffering) ``produce`` call
onto the default executor so the event loop never stalls on librdkafka
back-pressure.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import structlog

try:  # imported lazily-tolerant so unit tests run without librdkafka
    from confluent_kafka import Producer
except ImportError:  # pragma: no cover - exercised only in minimal test envs
    Producer = None  # type: ignore[assignment, misc]

from medflow_wearables.metrics import KAFKA_PUBLISH_FAILURES
from medflow_wearables.schemas import VitalsReading

log = structlog.get_logger(__name__)


def build_event(reading: VitalsReading) -> dict[str, Any]:
    """Platform-contract payload for ``vitals.raw`` (camelCase like dicom.received)."""
    return {
        "patientId": reading.patient_id,
        "ts": reading.ts.isoformat(),
        "heartRate": reading.heart_rate,
        "spo2": reading.spo2,
        "respRate": reading.resp_rate,
        "tempC": reading.temp_c,
        "systolicBp": reading.systolic_bp,
        "diastolicBp": reading.diastolic_bp,
    }


class VitalsProducer:
    def __init__(self, brokers: str, topic: str = "vitals.raw") -> None:
        if Producer is None:  # pragma: no cover
            raise RuntimeError("confluent-kafka is not installed")
        self._topic = topic
        self._producer = Producer(
            {
                "bootstrap.servers": brokers,
                "client.id": "wearables-ingester",
                "enable.idempotence": True,
                "linger.ms": 20,
            }
        )

    @staticmethod
    def _on_delivery(err: Any, msg: Any) -> None:
        if err is not None:
            KAFKA_PUBLISH_FAILURES.inc()
            log.error("kafka_delivery_failed", error=str(err))

    def _produce_sync(self, key: bytes, value: bytes) -> None:
        self._producer.produce(self._topic, key=key, value=value, on_delivery=self._on_delivery)
        self._producer.poll(0)

    async def publish(self, reading: VitalsReading) -> None:
        """Publish one reading, keyed by patient_id for per-patient ordering."""
        value = json.dumps(build_event(reading)).encode("utf-8")
        loop = asyncio.get_running_loop()
        try:
            await loop.run_in_executor(
                None, self._produce_sync, reading.patient_id.encode("utf-8"), value
            )
        except Exception:
            KAFKA_PUBLISH_FAILURES.inc()
            log.error("kafka_produce_failed", topic=self._topic, exc_info=True)

    def flush(self, timeout: float = 10.0) -> None:
        self._producer.flush(timeout)
