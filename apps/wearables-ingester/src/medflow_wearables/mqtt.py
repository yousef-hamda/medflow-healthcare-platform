"""aiomqtt consumer for ``vitals/+``.

Topic contract: ``vitals/{patient_id}`` with a JSON payload of the remaining
:class:`~medflow_wearables.schemas.VitalsReading` fields. The topic segment is
authoritative for ``patient_id`` and overrides any value in the payload.

Invalid messages (bad topic, malformed JSON, out-of-range vitals) are dropped
and counted — a flaky sensor must never wedge the ingest loop.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Awaitable, Callable

import structlog
from pydantic import ValidationError

try:  # guarded so parse_message stays importable in minimal test envs
    import aiomqtt
except ImportError:  # pragma: no cover - exercised only in minimal test envs
    aiomqtt = None  # type: ignore[assignment]

from medflow_wearables.metrics import MQTT_MESSAGES, VITALS_REJECTED
from medflow_wearables.schemas import VitalsReading

log = structlog.get_logger(__name__)

RECONNECT_DELAY_SECONDS = 5.0

ReadingHandler = Callable[[VitalsReading], Awaitable[None]]


def parse_message(topic: str, payload: bytes | str) -> VitalsReading:
    """Parse one MQTT message into a validated reading (pure; unit-tested).

    Raises ``ValueError`` for a malformed topic/JSON and pydantic
    ``ValidationError`` for out-of-range vitals.
    """
    parts = topic.split("/")
    if len(parts) != 2 or parts[0] != "vitals" or not parts[1]:
        raise ValueError(f"unexpected topic shape: {topic!r}")
    patient_id = parts[1]

    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ValueError("payload is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("payload must be a JSON object")

    data["patient_id"] = patient_id  # topic is authoritative
    return VitalsReading.model_validate(data)


async def run_mqtt_consumer(
    broker: str,
    port: int,
    topic_filter: str,
    on_reading: ReadingHandler,
) -> None:
    """Consume forever, reconnecting on broker failure; cancellation stops it."""
    if aiomqtt is None:  # pragma: no cover
        raise RuntimeError("aiomqtt is not installed")

    while True:
        try:
            async with aiomqtt.Client(broker, port=port, identifier="wearables-ingester") as client:
                await client.subscribe(topic_filter)
                log.info("mqtt_subscribed", broker=broker, topic_filter=topic_filter)
                async for message in client.messages:
                    await _handle_message(str(message.topic), bytes(message.payload), on_reading)
        except asyncio.CancelledError:
            log.info("mqtt_consumer_cancelled")
            raise
        except aiomqtt.MqttError:
            log.warning("mqtt_connection_lost", broker=broker, exc_info=True)
            await asyncio.sleep(RECONNECT_DELAY_SECONDS)


async def _handle_message(topic: str, payload: bytes, on_reading: ReadingHandler) -> None:
    try:
        reading = parse_message(topic, payload)
    except ValidationError:
        MQTT_MESSAGES.labels(outcome="invalid").inc()
        VITALS_REJECTED.labels(source="mqtt", reason="validation").inc()
        log.warning("mqtt_payload_rejected", topic=topic, reason="validation")
        return
    except ValueError as exc:
        MQTT_MESSAGES.labels(outcome="invalid").inc()
        VITALS_REJECTED.labels(source="mqtt", reason="malformed").inc()
        log.warning("mqtt_payload_rejected", topic=topic, reason=str(exc))
        return

    MQTT_MESSAGES.labels(outcome="accepted").inc()
    try:
        await on_reading(reading)
    except Exception:
        log.error("mqtt_reading_handler_failed", exc_info=True)
