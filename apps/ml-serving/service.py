"""BentoML packaging of the same MedFlow runners (alternative deployment).

The FastAPI app in ``medflow_serving.main`` is the primary serving path in
docker-compose; this module shows how the identical engines are packaged as
a Bento (``bentoml serve service:MedFlowService``, or ``bentoml build`` with
the adjacent bentofile.yaml) for environments standardised on Yatai/BentoCloud.

Synthetic data only - no PHI.
"""

from __future__ import annotations

from typing import Any

import bentoml
from pydantic import BaseModel

from medflow_serving.api.schemas import (
    NoteRequest,
    ReadmissionRequest,
    SepsisRequest,
    risk_band_for,
)
from medflow_serving.config import get_settings
from medflow_serving.inference.nlp import NotesNlpEngine
from medflow_serving.inference.readmission import ReadmissionEngine
from medflow_serving.inference.sepsis import SepsisEngine
from medflow_serving.registry.canary import CanaryConfig
from medflow_serving.registry.loader import ModelRegistry


class SepsisOut(BaseModel):
    risk_score: float
    risk_band: str
    shap_top5: list[dict[str, Any]]
    model_version: str


class ReadmissionOut(BaseModel):
    probability: float
    risk_band: str
    shap_top5: list[dict[str, Any]]
    model_version: str


@bentoml.service(name="medflow-ml", resources={"cpu": "2"}, traffic={"timeout": 30})
class MedFlowService:
    """One Bento service exposing the same runners as the FastAPI app."""

    def __init__(self) -> None:
        settings = get_settings()
        self.registry = ModelRegistry(
            tracking_uri=settings.mlflow_tracking_uri,
            stage=settings.model_stage,
            canary=CanaryConfig(
                enabled=settings.canary_enabled,
                canary_version=settings.canary_model_version,
                percent=settings.canary_percent,
            ),
        )
        self.sepsis = SepsisEngine()
        self.readmission = ReadmissionEngine()
        self.nlp = NotesNlpEngine()
        self.settings = settings

    @bentoml.api(route="/predict/sepsis")
    def predict_sepsis(self, body: SepsisRequest) -> SepsisOut:
        loaded = self.registry.model_for(
            self.settings.sepsis_model_name, body.patient_id, "pytorch"
        )
        result = self.sepsis.predict(body, loaded)
        return SepsisOut(
            risk_score=result.risk_score,
            risk_band=risk_band_for(result.risk_score).value,
            shap_top5=[s.model_dump() for s in result.shap_top5],
            model_version=result.model_version,
        )

    @bentoml.api(route="/predict/readmission")
    def predict_readmission(self, body: ReadmissionRequest) -> ReadmissionOut:
        loaded = self.registry.model_for(
            self.settings.readmission_model_name, body.patient_id, "xgboost"
        )
        result = self.readmission.predict(body, loaded)
        return ReadmissionOut(
            probability=result.probability,
            risk_band=risk_band_for(result.probability).value,
            shap_top5=[s.model_dump() for s in result.shap_top5],
            model_version=result.model_version,
        )

    @bentoml.api(route="/nlp/notes")
    def nlp_notes(self, body: NoteRequest) -> dict[str, Any]:
        entities = self.nlp.extract(body.text)
        return {
            "entities": [
                {
                    "text_span_redacted": e.text_span_redacted,
                    "label": e.label,
                    "concept_code": e.concept_code,
                    "negated": e.negated,
                }
                for e in entities
            ],
            "model_version": self.nlp.model_version,
        }
