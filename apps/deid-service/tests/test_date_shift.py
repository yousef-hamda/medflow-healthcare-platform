"""Date-shift engine: determinism, bounds, and interval preservation."""

from __future__ import annotations

from datetime import date

from medflow_deid.engine.date_shift import (
    MAX_SHIFT_DAYS,
    patient_offset_days,
    shift_fhir_date,
)

SECRET = "test-secret"


def test_offset_is_deterministic() -> None:
    a = patient_offset_days(SECRET, "pat-1")
    b = patient_offset_days(SECRET, "pat-1")
    assert a == b


def test_offset_within_bounds_and_never_zero() -> None:
    for i in range(500):
        offset = patient_offset_days(SECRET, f"pat-{i}")
        assert 1 <= abs(offset) <= MAX_SHIFT_DAYS
        assert offset != 0


def test_different_patients_get_different_offsets() -> None:
    offsets = {patient_offset_days(SECRET, f"pat-{i}") for i in range(200)}
    # Independent offsets — should not all collapse to one value.
    assert len(offsets) > 50


def test_secret_changes_offset() -> None:
    assert patient_offset_days("secret-a", "pat-1") != patient_offset_days(
        "secret-b", "pat-1"
    ) or patient_offset_days("secret-a", "pat-2") != patient_offset_days("secret-b", "pat-2")


def test_interval_preserved_across_dates() -> None:
    """The gap between two of a patient's dates is unchanged after shifting."""
    offset = patient_offset_days(SECRET, "pat-1")
    admit = "2026-01-10"
    discharge = "2026-01-25"
    shifted_admit = date.fromisoformat(shift_fhir_date(admit, offset))
    shifted_discharge = date.fromisoformat(shift_fhir_date(discharge, offset))
    original_gap = (date.fromisoformat(discharge) - date.fromisoformat(admit)).days
    shifted_gap = (shifted_discharge - shifted_admit).days
    assert original_gap == shifted_gap == 15


def test_precision_preserved() -> None:
    offset = patient_offset_days(SECRET, "pat-1")
    assert len(shift_fhir_date("2026", offset)) == 4  # year stays year
    assert len(shift_fhir_date("2026-06", offset)) == 7  # year-month stays year-month
    assert len(shift_fhir_date("2026-06-11", offset)) == 10  # full date


def test_datetime_zulu_preserved() -> None:
    offset = patient_offset_days(SECRET, "pat-1")
    out = shift_fhir_date("2026-06-11T09:30:00Z", offset)
    assert out.endswith("Z")
    assert "T09:30:00" in out  # time-of-day preserved


def test_actual_date_moves() -> None:
    offset = patient_offset_days(SECRET, "pat-1")
    assert shift_fhir_date("2026-06-11", offset) != "2026-06-11"
