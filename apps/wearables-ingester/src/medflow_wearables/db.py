"""SQLAlchemy 2.0 async persistence for vitals readings.

Duplicate handling is two-layered:

1. an in-process :class:`DedupCache` (bounded LRU keyed by
   ``(patient_id, ts)``) short-circuits the common case of devices re-sending
   recent samples without a round trip to Postgres;
2. the ``uq_vitals_patient_ts`` unique constraint plus
   ``INSERT .. ON CONFLICT DO NOTHING`` makes the write idempotent even across
   replicas / restarts, where the cache offers no guarantee.

The repository targets PostgreSQL (asyncpg); the schema itself is created by
the alembic migration in ``alembic/versions``.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Float, Index, String, UniqueConstraint, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from medflow_wearables.schemas import VitalsReading


class Base(DeclarativeBase):
    pass


class VitalsRow(Base):
    __tablename__ = "vitals"
    __table_args__ = (
        UniqueConstraint("patient_id", "ts", name="uq_vitals_patient_ts"),
        Index("ix_vitals_patient_ts", "patient_id", "ts"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    patient_id: Mapped[str] = mapped_column(String(64), nullable=False)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    heart_rate: Mapped[float] = mapped_column(Float, nullable=False)
    spo2: Mapped[float] = mapped_column(Float, nullable=False)
    resp_rate: Mapped[float] = mapped_column(Float, nullable=False)
    temp_c: Mapped[float] = mapped_column(Float, nullable=False)
    systolic_bp: Mapped[float] = mapped_column(Float, nullable=False)
    diastolic_bp: Mapped[float] = mapped_column(Float, nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class DedupCache:
    """Bounded LRU set of recently seen dedup keys (pure stdlib, unit-testable)."""

    def __init__(self, max_size: int = 100_000) -> None:
        if max_size < 1:
            raise ValueError("max_size must be >= 1")
        self._max_size = max_size
        self._seen: OrderedDict[Any, None] = OrderedDict()

    def seen(self, key: Any) -> bool:
        """Return True if *key* was already recorded; record it otherwise."""
        if key in self._seen:
            self._seen.move_to_end(key)
            return True
        self._seen[key] = None
        if len(self._seen) > self._max_size:
            self._seen.popitem(last=False)
        return False

    def __len__(self) -> int:
        return len(self._seen)


def create_db_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)


async def init_db(engine: AsyncEngine) -> None:
    """Dev convenience: create tables if missing. Alembic remains canonical."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


class VitalsRepository:
    """Upsert-ignoring-duplicates repository over the ``vitals`` table."""

    def __init__(self, engine: AsyncEngine, dedup_cache_size: int = 100_000) -> None:
        self._sessions = async_sessionmaker(engine, expire_on_commit=False)
        self._dedup = DedupCache(dedup_cache_size)

    async def insert(self, reading: VitalsReading) -> bool:
        """Insert one reading; return False if it is a duplicate (cache or DB)."""
        if self._dedup.seen(reading.dedup_key):
            return False
        stmt = (
            pg_insert(VitalsRow)
            .values(
                patient_id=reading.patient_id,
                ts=reading.ts,
                heart_rate=reading.heart_rate,
                spo2=reading.spo2,
                resp_rate=reading.resp_rate,
                temp_c=reading.temp_c,
                systolic_bp=reading.systolic_bp,
                diastolic_bp=reading.diastolic_bp,
            )
            .on_conflict_do_nothing(constraint="uq_vitals_patient_ts")
        )
        async with self._sessions() as session:
            result = await session.execute(stmt)
            await session.commit()
        return bool(result.rowcount)

    async def list_for_patient(
        self, patient_id: str, since: datetime | None = None, limit: int = 1000
    ) -> list[VitalsReading]:
        stmt = select(VitalsRow).where(VitalsRow.patient_id == patient_id)
        if since is not None:
            stmt = stmt.where(VitalsRow.ts >= since)
        stmt = stmt.order_by(VitalsRow.ts.asc()).limit(limit)
        async with self._sessions() as session:
            rows = (await session.execute(stmt)).scalars().all()
        return [VitalsReading.model_validate(row) for row in rows]
