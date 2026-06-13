"""C-STORE business-logic tests with fake dependencies (no network)."""

from __future__ import annotations

from types import SimpleNamespace
from typing import cast

from pydicom import dcmread
import io

from medflow_dicom.scp.handlers import (
    STATUS_OUT_OF_RESOURCES,
    STATUS_SUCCESS,
    Dependencies,
    handle_echo,
    handle_store,
    process_instance,
)
from tests.conftest import FakeFhir, FakeManifest, FakeProducer, FakeStore, make_dataset


def test_process_instance_persists_dicom(fake_deps: Dependencies) -> None:
    ds = make_dataset(patient_id="PAT-001")
    meta = process_instance(ds, fake_deps)

    store = cast(FakeStore, fake_deps.store)
    dcm_key = f"PAT-001/{meta.study_uid}/{meta.instance_uid}.dcm"
    assert ("imaging", dcm_key) in store.objects

    # round-trip: stored bytes are a valid DICOM file
    stored = dcmread(io.BytesIO(store.objects[("imaging", dcm_key)]))
    assert str(stored.SOPInstanceUID) == meta.instance_uid


def test_process_instance_writes_preview_and_manifest(fake_deps: Dependencies) -> None:
    ds = make_dataset()
    meta = process_instance(ds, fake_deps)

    store = cast(FakeStore, fake_deps.store)
    png_key = f"{meta.patient_id}/{meta.study_uid}/{meta.instance_uid}.preview.png"
    png = store.objects[("imaging", png_key)]
    assert png[:8] == b"\x89PNG\r\n\x1a\n"

    manifest = cast(FakeManifest, fake_deps.manifest)
    assert len(manifest.rows) == 1
    row = manifest.rows[0]
    assert row["preview_key"] == png_key
    assert row["modality"] == "CT"


def test_process_instance_emits_contract_event(fake_deps: Dependencies) -> None:
    ds = make_dataset(patient_id="PAT-7")
    meta = process_instance(ds, fake_deps)

    producer = cast(FakeProducer, fake_deps.producer)
    assert len(producer.events) == 1
    event_meta, s3_key, received_at = producer.events[0]
    assert event_meta.patient_id == "PAT-7"
    assert s3_key.endswith(".dcm")
    assert received_at.tzinfo is not None

    fhir = cast(FakeFhir, fake_deps.fhir)
    assert fhir.calls[0].study_uid == meta.study_uid


def test_fhir_failure_does_not_fail_store() -> None:
    deps = Dependencies(
        store=FakeStore(),
        fhir=FakeFhir(fail=True),
        producer=FakeProducer(),
        manifest=FakeManifest(),
    )
    ds = make_dataset()
    meta = process_instance(ds, deps)  # must not raise
    assert meta.patient_id == "PAT-001"
    assert len(deps.producer.events) == 1  # type: ignore[attr-defined]


def test_kafka_failure_does_not_fail_store() -> None:
    deps = Dependencies(
        store=FakeStore(),
        fhir=FakeFhir(),
        producer=FakeProducer(fail=True),
        manifest=FakeManifest(),
    )
    process_instance(make_dataset(), deps)  # must not raise


def test_handle_store_success(fake_deps: Dependencies) -> None:
    ds = make_dataset()
    event = SimpleNamespace(dataset=ds, file_meta=ds.file_meta)
    assert handle_store(event, fake_deps) == STATUS_SUCCESS


def test_handle_store_storage_failure_returns_dicom_error() -> None:
    class ExplodingStore(FakeStore):
        def put_bytes(self, *args: object, **kwargs: object) -> str | None:
            raise RuntimeError("minio down")

    deps = Dependencies(
        store=ExplodingStore(),
        fhir=FakeFhir(),
        producer=FakeProducer(),
        manifest=FakeManifest(),
    )
    ds = make_dataset()
    event = SimpleNamespace(dataset=ds, file_meta=ds.file_meta)
    assert handle_store(event, deps) == STATUS_OUT_OF_RESOURCES


def test_handle_echo() -> None:
    assert handle_echo(SimpleNamespace()) == 0x0000
