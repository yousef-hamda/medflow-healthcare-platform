"""Append-only persistence of prediction events (Postgres + Kafka).

Write path is fire-and-forget from the request handler's perspective:
persistence failures are logged, never surfaced to the caller, so a flaky
log store can't break clinical scoring.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine

from medflow_serving.logging_utils import get_logger
from medflow_serving.persistence.hashing import GENESIS_HASH, chain_hash, compute_input_hash
from medflow_serving.persistence.models import Base, PredictionRow

log = get_logger(__name__)


@dataclass(frozen=True)
class PredictionEvent:
    model: str
    model_version: str
    patient_id_hash: str
    input_payload: Any
    output_payload: Any
    latency_ms: int


def build_row(event: PredictionEvent, prev_hash: str, ts: datetime | None = None) -> PredictionRow:
    """Pure construction of a chained predictions row (unit-testable)."""
    at = ts or datetime.now(timezone.utc)
    input_hash = compute_input_hash(event.input_payload)
    output_json = json.dumps(event.output_payload, sort_keys=True, default=str)
    committed = {
        "ts": at.isoformat(),
        "model": event.model,
        "model_version": event.model_version,
        "patient_id_hash": event.patient_id_hash,
        "input_hash": input_hash,
        "output_json": output_json,
        "latency_ms": event.latency_ms,
    }
    return PredictionRow(
        ts=at,
        model=event.model,
        model_version=event.model_version,
        patient_id_hash=event.patient_id_hash,
        input_hash=input_hash,
        output_json=output_json,
        latency_ms=event.latency_ms,
        row_hash=chain_hash(prev_hash, committed),
    )


class PredictionStore:
    """Async writer for the predictions table + Kafka `predictions` topic."""

    def __init__(self, database_url: str, kafka_brokers: str, topic: str) -> None:
        self._engine: AsyncEngine = create_async_engine(database_url, pool_pre_ping=True)
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)
        self._kafka_brokers = kafka_brokers
        self._topic = topic
        self._producer: Any | None = None
        self._last_hash = GENESIS_HASH

    async def start(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        async with self._sessions() as session:
            result = await session.execute(
                select(PredictionRow.row_hash).order_by(PredictionRow.ts.desc()).limit(1)
            )
            tail = result.scalar_one_or_none()
            if tail:
                self._last_hash = tail
        try:
            from aiokafka import AIOKafkaProducer  # noqa: PLC0415

            self._producer = AIOKafkaProducer(
                bootstrap_servers=self._kafka_brokers,
                value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
            )
            await self._producer.start()
        except Exception as exc:
            log.warning("kafka_producer_unavailable", error=str(exc))
            self._producer = None

    async def stop(self) -> None:
        if self._producer is not None:
            await self._producer.stop()
        await self._engine.dispose()

    async def record(self, event: PredictionEvent) -> None:
        """Append one prediction row; emit the same event to Kafka."""
        try:
            row = build_row(event, prev_hash=self._last_hash)
            async with self._sessions() as session:
                session.add(row)
                await session.commit()
            self._last_hash = row.row_hash
            await self._emit(row)
        except Exception as exc:
            # Never fail a clinical scoring request because the log is down.
            log.error("prediction_persist_failed", model=event.model, error=str(exc))

    async def _emit(self, row: PredictionRow) -> None:
        if self._producer is None:
            return
        message = {
            "id": row.id,
            "ts": row.ts.isoformat() if row.ts else None,
            "model": row.model,
            "model_version": row.model_version,
            "patient_id_hash": row.patient_id_hash,
            "input_hash": row.input_hash,
            "output_json": row.output_json,
            "latency_ms": row.latency_ms,
            "row_hash": row.row_hash,
        }
        try:
            await self._producer.send_and_wait(self._topic, message)
        except Exception as exc:
            log.warning("prediction_kafka_emit_failed", error=str(exc))
