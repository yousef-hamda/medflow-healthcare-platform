"""Pydantic models for vitals intake with physiologic range validation.

Ranges are deliberately wide "physiologically possible" bounds, not clinical
alert thresholds: the goal is to reject sensor garbage (e.g. HR 8000 from a
loose strap) while never dropping a real, even extreme, reading.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_FUTURE_SKEW = timedelta(minutes=5)


class VitalsReading(BaseModel):
    """One wearable vitals sample for a single patient at a single instant."""

    model_config = ConfigDict(frozen=True, from_attributes=True)

    patient_id: str = Field(min_length=1, max_length=64)
    ts: datetime
    heart_rate: float = Field(ge=20, le=300, description="beats/min")
    spo2: float = Field(ge=50, le=100, description="peripheral O2 saturation, %")
    resp_rate: float = Field(ge=4, le=60, description="breaths/min")
    temp_c: float = Field(ge=30, le=43, description="core temperature, Celsius")
    systolic_bp: float = Field(ge=50, le=260, description="mmHg")
    diastolic_bp: float = Field(ge=20, le=160, description="mmHg")

    @field_validator("ts")
    @classmethod
    def _ts_not_in_future(cls, value: datetime) -> datetime:
        """Normalise to UTC-aware and reject timestamps >5 min in the future.

        Naive timestamps are interpreted as UTC (the contract for device
        firmware). A small positive skew is tolerated for clock drift.
        """
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        if value > datetime.now(timezone.utc) + MAX_FUTURE_SKEW:
            raise ValueError("ts is more than 5 minutes in the future")
        return value

    @property
    def dedup_key(self) -> tuple[str, datetime]:
        """Natural key used for duplicate suppression (matches the DB unique constraint)."""
        return (self.patient_id, self.ts)
