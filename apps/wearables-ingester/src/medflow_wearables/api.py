"""HTTP API: vitals intake/query plus /healthz and /metrics.

Dependencies (repository, Kafka producer) are taken from ``app.state`` so the
router is trivially testable with fakes (see tests/conftest.py).
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from medflow_wearables import __version__
from medflow_wearables.metrics import VITALS_ACCEPTED, VITALS_DUPLICATES
from medflow_wearables.schemas import VitalsReading

router = APIRouter()


@router.post("/v1/vitals", status_code=202)
async def ingest_vitals(reading: VitalsReading, request: Request) -> dict[str, str]:
    """Accept one reading; duplicates (same patient_id+ts) are acknowledged, not re-stored."""
    inserted = await request.app.state.repo.insert(reading)
    if not inserted:
        VITALS_DUPLICATES.labels(source="http").inc()
        return {"status": "duplicate"}
    VITALS_ACCEPTED.labels(source="http").inc()
    await request.app.state.producer.publish(reading)
    return {"status": "accepted"}


@router.get("/v1/vitals/{patient_id}")
async def list_vitals(
    patient_id: str, request: Request, since: datetime | None = None
) -> list[VitalsReading]:
    return await request.app.state.repo.list_for_patient(patient_id, since=since)  # type: ignore[no-any-return]


@router.get("/healthz")
def healthz(request: Request) -> dict[str, str]:
    return {
        "status": "ok",
        "service": request.app.state.settings.service_name,
        "version": __version__,
    }


@router.get("/metrics")
def metrics_endpoint() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
