"""Pydantic v2 request/response contracts for the serving API."""

from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field


class RiskBand(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


def risk_band_for(score: float, medium_threshold: float = 0.3, high_threshold: float = 0.6) -> RiskBand:
    """Map a probability to a clinical risk band (thresholds 0.3 / 0.6)."""
    if score >= high_threshold:
        return RiskBand.HIGH
    if score >= medium_threshold:
        return RiskBand.MEDIUM
    return RiskBand.LOW


class VitalsPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ts: datetime
    heart_rate: float = Field(ge=0, le=350)
    spo2: float = Field(ge=0, le=100)
    resp_rate: float = Field(ge=0, le=120)
    temp_c: float = Field(ge=20, le=45)
    map_mmhg: float = Field(ge=0, le=250)


class SepsisLabs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    wbc: float | None = Field(default=None, ge=0, description="White cell count, 10^3/uL")
    lactate: float | None = Field(default=None, ge=0, description="Serum lactate, mmol/L")
    creatinine: float | None = Field(default=None, ge=0, description="Creatinine, mg/dL")


class SepsisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: str = Field(min_length=1)
    vitals_window: list[VitalsPoint] = Field(min_length=1)
    labs: SepsisLabs = Field(default_factory=SepsisLabs)


class ShapItem(BaseModel):
    feature: str
    value: float
    impact: float


class SepsisResponse(BaseModel):
    risk_score: float = Field(ge=0, le=1)
    risk_band: RiskBand
    shap_top5: list[ShapItem]
    model_version: str


class Encounter(BaseModel):
    model_config = ConfigDict(extra="forbid")

    age: int = Field(ge=0, le=120)
    sex: str = Field(pattern="^(male|female|other|unknown)$")
    length_of_stay_days: float = Field(ge=0)
    prior_admissions_90d: int = Field(ge=0)
    prior_admissions_180d: int = Field(ge=0)
    prior_admissions_365d: int = Field(ge=0)
    diagnoses: list[str] = Field(default_factory=list, description="ICD-10 codes")
    discharge_disposition: str = "home"
    has_social_support: bool = True


class ReadmissionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patient_id: str = Field(min_length=1)
    encounter: Encounter


class ReadmissionResponse(BaseModel):
    probability: float = Field(ge=0, le=1)
    risk_band: RiskBand
    shap_top5: list[ShapItem]
    model_version: str


class XrayFinding(BaseModel):
    label: str
    probability: float = Field(ge=0, le=1)


class XrayResponse(BaseModel):
    findings: list[XrayFinding]
    gradcam_png_base64: str
    model_version: str


class NoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=100_000)


class NoteEntity(BaseModel):
    text_span_redacted: str
    label: str = Field(pattern="^(PROBLEM|MEDICATION|ALLERGY)$")
    concept_code: str | None = None
    negated: bool = False


class NoteResponse(BaseModel):
    entities: list[NoteEntity]
    model_version: str


class HealthResponse(BaseModel):
    status: str
    models: dict[str, str]
