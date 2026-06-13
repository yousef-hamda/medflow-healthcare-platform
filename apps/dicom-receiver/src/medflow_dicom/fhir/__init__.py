"""FHIR integration layer."""

from __future__ import annotations

from medflow_dicom.fhir.imaging_study import FhirClient, build_imaging_study

__all__ = ["FhirClient", "build_imaging_study"]
