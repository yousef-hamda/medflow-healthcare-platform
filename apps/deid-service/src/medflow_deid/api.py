"""HTTP API: text + FHIR de-identification, plus /healthz and /metrics.

Dependencies (text engine, audit client, settings) are taken from
``app.state`` so the router is trivially testable with fakes
(see tests/conftest.py).

Response contract: ``entities_removed`` lists entity *types* only
(``["PHONE_NUMBER", "MRN"]``) — never the removed values, so the response
itself carries no PHI.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Request, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from pydantic import BaseModel, Field

from medflow_deid import __version__
from medflow_deid.engine.fhir_walker import deidentify_resource
from medflow_deid.metrics import DEID_ENTITIES_REMOVED, DEID_REQUESTS

router = APIRouter()


class TextDeidRequest(BaseModel):
    text: str
    patient_id: str = Field(min_length=1)


class TextDeidResponse(BaseModel):
    text: str
    entities_removed: list[str]


class FhirDeidRequest(BaseModel):
    resource: dict[str, Any]


class FhirDeidResponse(BaseModel):
    resource: dict[str, Any]
    entities_removed: list[str]


@router.post("/v1/deid/text", response_model=TextDeidResponse)
async def deid_text(payload: TextDeidRequest, request: Request) -> TextDeidResponse:
    state = request.app.state
    cleaned, entities = state.text_engine.scrub(payload.text)
    for entity_type in entities:
        DEID_ENTITIES_REMOVED.labels(entity_type=entity_type).inc()
    DEID_REQUESTS.labels(endpoint="text", status="ok").inc()
    state.audit.emit(
        action="deidentify",
        resource_type="FreeText",
        resource_id=payload.patient_id,
        justification="HIPAA Safe Harbor de-identification of free-text clinical note",
    )
    return TextDeidResponse(text=cleaned, entities_removed=entities)


@router.post("/v1/deid/fhir", response_model=FhirDeidResponse)
async def deid_fhir(payload: FhirDeidRequest, request: Request) -> Response:
    state = request.app.state
    try:
        cleaned, entities = deidentify_resource(
            payload.resource,
            state.settings.date_shift_secret,
            text_engine=state.text_engine,
        )
    except ValueError as exc:
        DEID_REQUESTS.labels(endpoint="fhir", status="rejected").inc()
        return Response(
            content=json.dumps({"detail": str(exc)}),
            media_type="application/json",
            status_code=422,
        )
    for entity_type in entities:
        DEID_ENTITIES_REMOVED.labels(entity_type=entity_type).inc()
    DEID_REQUESTS.labels(endpoint="fhir", status="ok").inc()
    state.audit.emit(
        action="deidentify",
        resource_type=str(payload.resource.get("resourceType", "Resource")),
        resource_id=str(payload.resource.get("id", "unknown")),
        justification="HIPAA Safe Harbor de-identification of FHIR resource",
    )
    body = FhirDeidResponse(resource=cleaned, entities_removed=entities)
    return Response(content=body.model_dump_json(), media_type="application/json")


@router.get("/healthz")
def healthz(request: Request) -> dict[str, Any]:
    state = request.app.state
    return {
        "status": "ok",
        "service": state.settings.service_name,
        "version": __version__,
        "presidio_active": getattr(state.text_engine, "presidio_active", False),
    }


@router.get("/metrics")
def metrics_endpoint() -> Response:
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
