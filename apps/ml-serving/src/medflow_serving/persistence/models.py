"""SQLAlchemy ORM model for the append-only ``predictions`` table.

Privacy: only the salted hash of the patient id is stored (patient_id_hash),
plus a hash of the input payload - never raw identifiers or raw inputs.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Index, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class PredictionRow(Base):
    __tablename__ = "predictions"
    __table_args__ = (
        Index("ix_predictions_model_ts", "model", "ts"),
        Index("ix_predictions_patient_hash", "patient_id_hash"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    patient_id_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    input_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    output_json: Mapped[str] = mapped_column(Text, nullable=False)
    latency_ms: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Tamper-evident chain link over (prev row hash || this row's payload).
    row_hash: Mapped[str] = mapped_column(String(64), nullable=False)
