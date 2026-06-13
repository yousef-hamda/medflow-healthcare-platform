"""Shared fixtures: valid payloads, fake repository/producer, wired test app."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi import FastAPI

from medflow_wearables.api import router
from medflow_wearables.config import Settings
from medflow_wearables.schemas import VitalsReading


def valid_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "patient_id": "PAT-001",
        "ts": "2026-06-01T12:00:00+00:00",
        "heart_rate": 72,
        "spo2": 98,
        "resp_rate": 16,
        "temp_c": 36.8,
        "systolic_bp": 120,
        "diastolic_bp": 80,
    }
    payload.update(overrides)
    return payload


def make_reading(**overrides: Any) -> VitalsReading:
    return VitalsReading.model_validate(valid_payload(**overrides))


class FakeRepo:
    """In-memory stand-in for VitalsRepository with the same dedup contract."""

    def __init__(self) -> None:
        self.readings: list[VitalsReading] = []
        self._keys: set[tuple[str, datetime]] = set()

    async def insert(self, reading: VitalsReading) -> bool:
        if reading.dedup_key in self._keys:
            return False
        self._keys.add(reading.dedup_key)
        self.readings.append(reading)
        return True

    async def list_for_patient(
        self, patient_id: str, since: datetime | None = None, limit: int = 1000
    ) -> list[VitalsReading]:
        rows = [r for r in self.readings if r.patient_id == patient_id]
        if since is not None:
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
            rows = [r for r in rows if r.ts >= since]
        return sorted(rows, key=lambda r: r.ts)[:limit]


class FakeProducer:
    def __init__(self) -> None:
        self.published: list[VitalsReading] = []

    async def publish(self, reading: VitalsReading) -> None:
        self.published.append(reading)


@pytest.fixture
def fake_repo() -> FakeRepo:
    return FakeRepo()


@pytest.fixture
def fake_producer() -> FakeProducer:
    return FakeProducer()


@pytest.fixture
def app(fake_repo: FakeRepo, fake_producer: FakeProducer) -> FastAPI:
    """Router under test with fakes on app.state (no lifespan side effects)."""
    test_app = FastAPI()
    test_app.include_router(router)
    test_app.state.settings = Settings()
    test_app.state.repo = fake_repo
    test_app.state.producer = fake_producer
    return test_app
