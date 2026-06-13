"""C-ECHO / C-STORE event handlers.

``process_instance`` contains all business logic and takes plain dependencies
so it is unit-testable with pydicom Datasets and fakes (no network, no
pynetdicom event machinery).

C-STORE flow:
1. persist the original DICOM file to MinIO (imaging bucket)
2. extract pseudonymised header metadata (PatientName is never read)
3. conditional-create a FHIR ImagingStudy
4. emit a ``dicom.received`` Kafka event
5. preprocessing pipeline: 224x224 PNG preview + Parquet manifest row

Steps 3-5 are best-effort: a FHIR/preview/manifest failure is logged and
counted but does not fail the C-STORE (the image is already durably stored).
"""

from __future__ import annotations

import io
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

import structlog
from pydicom import dcmwrite
from pydicom.dataset import Dataset

from medflow_dicom import metrics
from medflow_dicom.metadata import InstanceMetadata, extract_metadata
from medflow_dicom.pipeline.preprocess import render_preview
from medflow_dicom.storage.paths import instance_key, preview_key

log = structlog.get_logger(__name__)

# DICOM status codes
STATUS_SUCCESS = 0x0000
STATUS_OUT_OF_RESOURCES = 0xA700
STATUS_CANNOT_UNDERSTAND = 0xC000


class SupportsPutGet(Protocol):
    def put_bytes(self, bucket: str, key: str, data: bytes, content_type: str = ...) -> str | None: ...
    def get_bytes(self, bucket: str, key: str) -> bytes | None: ...


class SupportsUpsert(Protocol):
    def upsert_imaging_study(self, meta: InstanceMetadata) -> int: ...


class SupportsPublish(Protocol):
    def publish(self, meta: InstanceMetadata, s3_key: str, received_at: datetime) -> None: ...


class SupportsAppend(Protocol):
    def append(self, row: dict[str, Any]) -> None: ...


@dataclass
class Dependencies:
    store: SupportsPutGet
    fhir: SupportsUpsert
    producer: SupportsPublish
    manifest: SupportsAppend
    imaging_bucket: str = "imaging"


def _serialize(ds: Dataset) -> bytes:
    buf = io.BytesIO()
    dcmwrite(buf, ds, write_like_original=False)
    return buf.getvalue()


def process_instance(ds: Dataset, deps: Dependencies) -> InstanceMetadata:
    """Run the full C-STORE business flow for one dataset."""
    meta = extract_metadata(ds)
    received_at = datetime.now(timezone.utc)
    s3_key = instance_key(meta.patient_id, meta.study_uid, meta.instance_uid)

    # 1. Durable persistence first; any failure here fails the C-STORE.
    deps.store.put_bytes(deps.imaging_bucket, s3_key, _serialize(ds), content_type="application/dicom")
    log.info(
        "instance_stored",
        s3_key=s3_key,
        modality=meta.modality,
        study_uid=meta.study_uid,
        series_uid=meta.series_uid,
        instance_uid=meta.instance_uid,
    )

    # 2. FHIR ImagingStudy (best-effort).
    try:
        deps.fhir.upsert_imaging_study(meta)
    except Exception:
        metrics.STORE_FAILURES.labels(stage="fhir").inc()
        log.warning("fhir_upsert_failed", study_uid=meta.study_uid, exc_info=True)

    # 3. Kafka event (best-effort).
    try:
        deps.producer.publish(meta, s3_key, received_at)
    except Exception:
        metrics.STORE_FAILURES.labels(stage="kafka").inc()
        log.warning("kafka_publish_failed", study_uid=meta.study_uid, exc_info=True)

    # 4. Preprocessing pipeline (best-effort).
    png_key = ""
    try:
        png = render_preview(ds)
        png_key = preview_key(meta.patient_id, meta.study_uid, meta.instance_uid)
        deps.store.put_bytes(deps.imaging_bucket, png_key, png, content_type="image/png")
        metrics.PREVIEWS_GENERATED.inc()
    except Exception:
        metrics.STORE_FAILURES.labels(stage="preview").inc()
        log.warning("preview_failed", instance_uid=meta.instance_uid, exc_info=True)

    try:
        deps.manifest.append(
            {
                "patient_id": meta.patient_id,
                "study_uid": meta.study_uid,
                "series_uid": meta.series_uid,
                "instance_uid": meta.instance_uid,
                "modality": meta.modality,
                "body_part": meta.body_part or "",
                "study_date": meta.study_date or "",
                "s3_key": s3_key,
                "preview_key": png_key,
                "received_at": received_at.isoformat(),
            }
        )
    except Exception:
        metrics.STORE_FAILURES.labels(stage="manifest").inc()
        log.warning("manifest_append_failed", instance_uid=meta.instance_uid, exc_info=True)

    metrics.INSTANCES_RECEIVED.labels(modality=meta.modality).inc()
    return meta


def handle_store(event: Any, deps: Dependencies) -> int:
    """pynetdicom EVT_C_STORE handler; returns a DICOM status code."""
    started = time.monotonic()
    try:
        ds = event.dataset
        ds.file_meta = event.file_meta
    except Exception:
        metrics.STORE_FAILURES.labels(stage="decode").inc()
        log.warning("c_store_decode_failed", exc_info=True)
        return STATUS_CANNOT_UNDERSTAND

    try:
        process_instance(ds, deps)
    except Exception:
        metrics.STORE_FAILURES.labels(stage="storage").inc()
        log.error("c_store_failed", exc_info=True)
        return STATUS_OUT_OF_RESOURCES
    finally:
        metrics.STORE_LATENCY.observe(time.monotonic() - started)
    return STATUS_SUCCESS


def handle_echo(event: Any) -> int:
    """pynetdicom EVT_C_ECHO handler."""
    log.info("c_echo_received")
    return STATUS_SUCCESS
