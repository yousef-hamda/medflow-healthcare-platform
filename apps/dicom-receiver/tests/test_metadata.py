"""Header metadata extraction tests."""

from __future__ import annotations

from medflow_dicom.metadata import _dicom_date_to_iso, extract_metadata
from tests.conftest import make_dataset


def test_extract_metadata_fields() -> None:
    ds = make_dataset(patient_id="PAT-42", modality="CR", study_date="20251231")
    meta = extract_metadata(ds)
    assert meta.patient_id == "PAT-42"
    assert meta.modality == "CR"
    assert meta.body_part == "CHEST"
    assert meta.study_date == "2025-12-31"
    assert meta.study_uid == str(ds.StudyInstanceUID)
    assert meta.instance_uid == str(ds.SOPInstanceUID)


def test_extract_metadata_never_contains_patient_name() -> None:
    ds = make_dataset()
    meta = extract_metadata(ds)
    dumped = meta.model_dump()
    assert "SYNTHETIC" not in str(dumped)
    assert "PatientName" not in dumped


def test_missing_patient_id_falls_back() -> None:
    ds = make_dataset(with_pixels=False)
    del ds.PatientID
    meta = extract_metadata(ds)
    assert meta.patient_id == "UNKNOWN"


def test_dicom_date_parsing() -> None:
    assert _dicom_date_to_iso("20260105") == "2026-01-05"
    assert _dicom_date_to_iso("garbage") is None
    assert _dicom_date_to_iso("") is None
    assert _dicom_date_to_iso(None) is None
    assert _dicom_date_to_iso("202601") is None
