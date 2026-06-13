"""Boundary tests for VitalsReading physiologic ranges and timestamp rules."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from medflow_wearables.schemas import VitalsReading

from .conftest import make_reading, valid_payload

BOUNDS = {
    "heart_rate": (20, 300),
    "spo2": (50, 100),
    "resp_rate": (4, 60),
    "temp_c": (30, 43),
    "systolic_bp": (50, 260),
    "diastolic_bp": (20, 160),
}


def test_valid_reading_accepted() -> None:
    reading = make_reading()
    assert reading.patient_id == "PAT-001"
    assert reading.ts.tzinfo is not None


@pytest.mark.parametrize(("field", "bounds"), BOUNDS.items())
def test_inclusive_boundaries_accepted(field: str, bounds: tuple[float, float]) -> None:
    low, high = bounds
    assert getattr(make_reading(**{field: low}), field) == low
    assert getattr(make_reading(**{field: high}), field) == high


@pytest.mark.parametrize(("field", "bounds"), BOUNDS.items())
def test_out_of_range_rejected(field: str, bounds: tuple[float, float]) -> None:
    low, high = bounds
    with pytest.raises(ValidationError):
        make_reading(**{field: low - 0.1})
    with pytest.raises(ValidationError):
        make_reading(**{field: high + 0.1})


def test_ts_far_future_rejected() -> None:
    future = datetime.now(timezone.utc) + timedelta(minutes=6)
    with pytest.raises(ValidationError, match="future"):
        make_reading(ts=future.isoformat())


def test_ts_small_skew_tolerated() -> None:
    near_future = datetime.now(timezone.utc) + timedelta(minutes=4)
    assert make_reading(ts=near_future.isoformat()).ts == near_future


def test_naive_ts_assumed_utc() -> None:
    reading = make_reading(ts="2026-06-01T12:00:00")
    assert reading.ts.tzinfo is not None
    assert reading.ts.utcoffset() == timedelta(0)


def test_empty_patient_id_rejected() -> None:
    with pytest.raises(ValidationError):
        make_reading(patient_id="")


def test_missing_field_rejected() -> None:
    payload = valid_payload()
    del payload["spo2"]
    with pytest.raises(ValidationError):
        VitalsReading.model_validate(payload)


def test_dedup_key() -> None:
    reading = make_reading()
    assert reading.dedup_key == (reading.patient_id, reading.ts)
