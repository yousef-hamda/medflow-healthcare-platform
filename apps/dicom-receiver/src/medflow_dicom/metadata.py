"""DICOM header metadata extraction (pseudonymised: PatientName is never read out)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class InstanceMetadata(BaseModel):
    """The non-PHI header subset we keep for routing, FHIR mapping and events."""

    patient_id: str = Field(min_length=1)
    study_uid: str = Field(min_length=1)
    series_uid: str = Field(min_length=1)
    instance_uid: str = Field(min_length=1)
    sop_class_uid: str = ""
    modality: str = "OT"
    body_part: str | None = None
    study_date: str | None = None  # ISO-8601 date


def _dicom_date_to_iso(value: str | None) -> str | None:
    """Convert a DICOM DA value (YYYYMMDD) to ISO-8601, or None if malformed."""
    if not value:
        return None
    raw = value.strip()
    if len(raw) != 8 or not raw.isdigit():
        return None
    return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"


def extract_metadata(ds: Any) -> InstanceMetadata:
    """Extract header metadata from a pydicom Dataset.

    Deliberately never touches PatientName, PatientBirthDate, or any other
    direct identifier beyond the opaque PatientID used for routing.
    """
    return InstanceMetadata(
        patient_id=str(getattr(ds, "PatientID", "") or "UNKNOWN"),
        study_uid=str(getattr(ds, "StudyInstanceUID", "")),
        series_uid=str(getattr(ds, "SeriesInstanceUID", "")),
        instance_uid=str(getattr(ds, "SOPInstanceUID", "")),
        sop_class_uid=str(getattr(ds, "SOPClassUID", "") or ""),
        modality=str(getattr(ds, "Modality", "") or "OT"),
        body_part=str(getattr(ds, "BodyPartExamined", "") or "") or None,
        study_date=_dicom_date_to_iso(str(getattr(ds, "StudyDate", "") or "")),
    )
