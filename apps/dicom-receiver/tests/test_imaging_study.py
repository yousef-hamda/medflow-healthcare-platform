"""FHIR ImagingStudy mapping tests."""

from __future__ import annotations

from medflow_dicom.fhir.imaging_study import DICOM_UID_SYSTEM, build_imaging_study
from medflow_dicom.metadata import InstanceMetadata


def _meta(**overrides: object) -> InstanceMetadata:
    base: dict[str, object] = {
        "patient_id": "PAT-9",
        "study_uid": "1.2.3.4",
        "series_uid": "1.2.3.4.5",
        "instance_uid": "1.2.3.4.5.6",
        "sop_class_uid": "1.2.840.10008.5.1.4.1.1.2",
        "modality": "CT",
        "body_part": "CHEST",
        "study_date": "2026-01-05",
    }
    base.update(overrides)
    return InstanceMetadata(**base)  # type: ignore[arg-type]


def test_imaging_study_structure() -> None:
    resource = build_imaging_study(_meta())
    assert resource["resourceType"] == "ImagingStudy"
    assert resource["status"] == "available"
    assert resource["subject"] == {"reference": "Patient/PAT-9"}
    assert resource["started"] == "2026-01-05"
    assert resource["modality"][0]["code"] == "CT"


def test_imaging_study_identifier_is_study_uid() -> None:
    resource = build_imaging_study(_meta())
    identifier = resource["identifier"][0]
    assert identifier["system"] == DICOM_UID_SYSTEM
    assert identifier["value"] == "urn:oid:1.2.3.4"


def test_imaging_study_series_and_instance() -> None:
    resource = build_imaging_study(_meta())
    series = resource["series"][0]
    assert series["uid"] == "1.2.3.4.5"
    assert series["instance"][0]["uid"] == "1.2.3.4.5.6"
    assert series["bodySite"]["display"] == "CHEST"


def test_imaging_study_without_optional_fields() -> None:
    resource = build_imaging_study(_meta(body_part=None, study_date=None))
    assert "started" not in resource
    assert "bodySite" not in resource["series"][0]


def test_imaging_study_contains_no_patient_name() -> None:
    assert "SYNTHETIC" not in str(build_imaging_study(_meta()))
