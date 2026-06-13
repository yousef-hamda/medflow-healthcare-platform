"""HTTP routes. Every prediction is canary-routed, persisted append-only,
and emitted to Kafka. Responses carry an ``X-Model-Track`` header."""

from __future__ import annotations

import time

from fastapi import APIRouter, File, Request, Response, UploadFile

from medflow_serving.api.schemas import (
    HealthResponse,
    NoteEntity,
    NoteRequest,
    NoteResponse,
    ReadmissionRequest,
    ReadmissionResponse,
    SepsisRequest,
    SepsisResponse,
    XrayResponse,
    risk_band_for,
)
from medflow_serving.config import get_settings
from medflow_serving.inference.nlp import NotesNlpEngine
from medflow_serving.inference.readmission import ReadmissionEngine
from medflow_serving.inference.sepsis import SepsisEngine
from medflow_serving.inference.xray import XrayEngine
from medflow_serving.logging_utils import get_logger, hash_id
from medflow_serving.persistence.repository import PredictionEvent, PredictionStore
from medflow_serving.registry.loader import ModelRegistry

log = get_logger(__name__)
router = APIRouter()

_sepsis_engine = SepsisEngine()
_readmission_engine = ReadmissionEngine()
_xray_engine = XrayEngine()
_nlp_engine = NotesNlpEngine()


def _registry(request: Request) -> ModelRegistry:
    return request.app.state.registry  # type: ignore[no-any-return]


def _store(request: Request) -> PredictionStore | None:
    return getattr(request.app.state, "prediction_store", None)


async def _record(
    request: Request,
    model: str,
    model_version: str,
    patient_id: str,
    input_payload: object,
    output_payload: object,
    started: float,
) -> None:
    store = _store(request)
    if store is None:
        return
    settings = get_settings()
    await store.record(
        PredictionEvent(
            model=model,
            model_version=model_version,
            patient_id_hash=hash_id(patient_id, settings.hash_salt),
            input_payload=input_payload,
            output_payload=output_payload,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )
    )


@router.get("/healthz", response_model=HealthResponse)
async def healthz(request: Request) -> HealthResponse:
    return HealthResponse(status="ok", models=_registry(request).loaded_versions())


@router.post("/predict/sepsis", response_model=SepsisResponse)
async def predict_sepsis(
    request: Request, response: Response, body: SepsisRequest
) -> SepsisResponse:
    settings = get_settings()
    started = time.perf_counter()
    loaded = _registry(request).model_for(settings.sepsis_model_name, body.patient_id, "pytorch")
    response.headers["X-Model-Track"] = loaded.track.value

    result = _sepsis_engine.predict(body, loaded)
    out = SepsisResponse(
        risk_score=result.risk_score,
        risk_band=risk_band_for(result.risk_score),
        shap_top5=result.shap_top5,
        model_version=result.model_version,
    )
    log.info(
        "prediction",
        model=settings.sepsis_model_name,
        model_version=result.model_version,
        track=loaded.track.value,
        patient_id_hash=hash_id(body.patient_id, settings.hash_salt),
        risk_band=out.risk_band.value,
    )
    await _record(
        request,
        settings.sepsis_model_name,
        result.model_version,
        body.patient_id,
        body.model_dump(mode="json"),
        out.model_dump(mode="json"),
        started,
    )
    return out


@router.post("/predict/readmission", response_model=ReadmissionResponse)
async def predict_readmission(
    request: Request, response: Response, body: ReadmissionRequest
) -> ReadmissionResponse:
    settings = get_settings()
    started = time.perf_counter()
    loaded = _registry(request).model_for(
        settings.readmission_model_name, body.patient_id, "xgboost"
    )
    response.headers["X-Model-Track"] = loaded.track.value

    result = _readmission_engine.predict(body, loaded)
    out = ReadmissionResponse(
        probability=result.probability,
        risk_band=risk_band_for(result.probability),
        shap_top5=result.shap_top5,
        model_version=result.model_version,
    )
    log.info(
        "prediction",
        model=settings.readmission_model_name,
        model_version=result.model_version,
        track=loaded.track.value,
        patient_id_hash=hash_id(body.patient_id, settings.hash_salt),
        risk_band=out.risk_band.value,
    )
    await _record(
        request,
        settings.readmission_model_name,
        result.model_version,
        body.patient_id,
        body.model_dump(mode="json"),
        out.model_dump(mode="json"),
        started,
    )
    return out


@router.post("/predict/chest-xray", response_model=XrayResponse)
async def predict_chest_xray(
    request: Request,
    response: Response,
    file: UploadFile = File(...),  # noqa: B008
    patient_id: str = "unknown",
) -> XrayResponse:
    settings = get_settings()
    started = time.perf_counter()
    loaded = _registry(request).model_for(settings.xray_model_name, patient_id, "pytorch")
    response.headers["X-Model-Track"] = loaded.track.value

    payload = await file.read()
    result = _xray_engine.predict(payload, file.filename, file.content_type, loaded)
    out = XrayResponse(
        findings=result.findings,
        gradcam_png_base64=result.gradcam_png_base64,
        model_version=result.model_version,
    )
    log.info(
        "prediction",
        model=settings.xray_model_name,
        model_version=result.model_version,
        track=loaded.track.value,
        patient_id_hash=hash_id(patient_id, settings.hash_salt),
        n_findings=len(out.findings),
    )
    # Input hash over image bytes digest only - the image itself is not stored.
    await _record(
        request,
        settings.xray_model_name,
        result.model_version,
        patient_id,
        {"filename": file.filename, "bytes_sha256_len": len(payload)},
        {"findings": [f.model_dump() for f in out.findings]},
        started,
    )
    return out


@router.post("/nlp/notes", response_model=NoteResponse)
async def nlp_notes(request: Request, response: Response, body: NoteRequest) -> NoteResponse:
    started = time.perf_counter()
    entities = _nlp_engine.extract(body.text)
    version = _nlp_engine.model_version
    response.headers["X-Model-Track"] = "stable"
    out = NoteResponse(
        entities=[
            NoteEntity(
                text_span_redacted=e.text_span_redacted,
                label=e.label,
                concept_code=e.concept_code,
                negated=e.negated,
            )
            for e in entities
        ],
        model_version=version,
    )
    settings = get_settings()
    # Note text is PHI-adjacent even when synthetic: persist only its hash.
    await _record(
        request,
        "clinical-note-nlp",
        version,
        "n/a",
        {"text_chars": len(body.text)},
        {"n_entities": len(out.entities)},
        started,
    )
    log.info("nlp_extraction", model_version=version, n_entities=len(out.entities))
    _ = settings
    return out
