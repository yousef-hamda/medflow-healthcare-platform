"""confluent-kafka producer for the ``dicom.received`` topic."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import structlog
from confluent_kafka import Producer

from medflow_dicom.metadata import InstanceMetadata

log = structlog.get_logger(__name__)


def build_event(meta: InstanceMetadata, s3_key: str, received_at: datetime) -> dict[str, Any]:
    """Platform-contract payload for ``dicom.received``."""
    return {
        "patientId": meta.patient_id,
        "studyUid": meta.study_uid,
        "seriesUid": meta.series_uid,
        "instanceUid": meta.instance_uid,
        "modality": meta.modality,
        "s3Key": s3_key,
        "receivedAt": received_at.isoformat(),
    }


class DicomEventProducer:
    def __init__(self, brokers: str, topic: str = "dicom.received") -> None:
        self._topic = topic
        self._producer = Producer(
            {
                "bootstrap.servers": brokers,
                "client.id": "dicom-receiver",
                "enable.idempotence": True,
                "linger.ms": 20,
            }
        )

    @staticmethod
    def _on_delivery(err: Any, msg: Any) -> None:
        if err is not None:
            log.error("kafka_delivery_failed", error=str(err))

    def publish(self, meta: InstanceMetadata, s3_key: str, received_at: datetime) -> None:
        event = build_event(meta, s3_key, received_at)
        self._producer.produce(
            self._topic,
            key=meta.patient_id.encode("utf-8"),
            value=json.dumps(event).encode("utf-8"),
            on_delivery=self._on_delivery,
        )
        self._producer.poll(0)
        log.info(
            "dicom_event_published",
            topic=self._topic,
            study_uid=meta.study_uid,
            instance_uid=meta.instance_uid,
        )

    def flush(self, timeout: float = 10.0) -> None:
        self._producer.flush(timeout)
