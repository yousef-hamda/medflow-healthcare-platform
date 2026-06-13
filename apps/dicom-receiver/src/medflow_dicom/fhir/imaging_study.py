"""FHIR R4 ImagingStudy builder + conditional-create client.

Conditional create: we POST with an ``If-None-Exist`` header on the study UID
identifier so repeated C-STOREs of the same study never duplicate the
ImagingStudy resource (HAPI returns 200 with the existing resource instead of
creating a new one).
"""

from __future__ import annotations

from typing import Any

import httpx
import structlog

from medflow_dicom.metadata import InstanceMetadata

log = structlog.get_logger(__name__)

DICOM_UID_SYSTEM = "urn:dicom:uid"
DCM_MODALITY_SYSTEM = "http://dicom.nema.org/resources/ontology/DCM"


def build_imaging_study(meta: InstanceMetadata) -> dict[str, Any]:
    """Map extracted DICOM header metadata to a FHIR R4 ImagingStudy resource."""
    series: dict[str, Any] = {
        "uid": meta.series_uid,
        "modality": {"system": DCM_MODALITY_SYSTEM, "code": meta.modality},
        "numberOfInstances": 1,
        "instance": [
            {
                "uid": meta.instance_uid,
                "sopClass": {"system": "urn:ietf:rfc:3986", "code": f"urn:oid:{meta.sop_class_uid}"},
            }
        ],
    }
    if meta.body_part:
        series["bodySite"] = {"display": meta.body_part}

    resource: dict[str, Any] = {
        "resourceType": "ImagingStudy",
        "status": "available",
        "identifier": [{"system": DICOM_UID_SYSTEM, "value": f"urn:oid:{meta.study_uid}"}],
        "subject": {"reference": f"Patient/{meta.patient_id}"},
        "modality": [{"system": DCM_MODALITY_SYSTEM, "code": meta.modality}],
        "numberOfSeries": 1,
        "numberOfInstances": 1,
        "series": [series],
    }
    if meta.study_date:
        resource["started"] = meta.study_date
    return resource


class FhirClient:
    """Minimal synchronous FHIR client (used from the SCP worker threads)."""

    def __init__(self, base_url: str, client: httpx.Client | None = None) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(timeout=10.0)

    def upsert_imaging_study(self, meta: InstanceMetadata) -> int:
        """Conditionally create the ImagingStudy; returns the HTTP status code."""
        resource = build_imaging_study(meta)
        response = self._client.post(
            f"{self._base_url}/ImagingStudy",
            json=resource,
            headers={
                "Content-Type": "application/fhir+json",
                "If-None-Exist": f"identifier={DICOM_UID_SYSTEM}|urn:oid:{meta.study_uid}",
            },
        )
        response.raise_for_status()
        log.info(
            "imaging_study_upserted",
            study_uid=meta.study_uid,
            status_code=response.status_code,
        )
        return response.status_code

    def close(self) -> None:
        self._client.close()
