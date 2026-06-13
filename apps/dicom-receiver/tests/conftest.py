"""Shared fixtures: synthetic pydicom datasets and fake dependencies."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import numpy as np
import pytest
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from medflow_dicom.metadata import InstanceMetadata
from medflow_dicom.scp.handlers import Dependencies

CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2"


def make_dataset(
    patient_id: str = "PAT-001",
    modality: str = "CT",
    study_date: str = "20260105",
    with_pixels: bool = True,
) -> Dataset:
    ds = Dataset()
    ds.PatientID = patient_id
    ds.PatientName = "SYNTHETIC^ONLY"  # synthetic; must never appear in logs/events
    ds.Modality = modality
    ds.StudyDate = study_date
    ds.BodyPartExamined = "CHEST"
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.SOPInstanceUID = generate_uid()
    ds.SOPClassUID = CT_IMAGE_STORAGE

    if with_pixels:
        rows, cols = 32, 32
        ds.Rows = rows
        ds.Columns = cols
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated = 16
        ds.BitsStored = 16
        ds.HighBit = 15
        ds.PixelRepresentation = 0
        ds.PixelData = (
            np.linspace(0, 4095, rows * cols, dtype=np.uint16).reshape(rows, cols).tobytes()
        )

    file_meta = FileMetaDataset()
    file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta = file_meta
    return ds


class FakeStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self, bucket: str, key: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str | None:
        self.objects[(bucket, key)] = data
        return "fake-etag"

    def get_bytes(self, bucket: str, key: str) -> bytes | None:
        return self.objects.get((bucket, key))


class FakeFhir:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[InstanceMetadata] = []

    def upsert_imaging_study(self, meta: InstanceMetadata) -> int:
        if self.fail:
            raise RuntimeError("fhir down")
        self.calls.append(meta)
        return 201


class FakeProducer:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.events: list[tuple[InstanceMetadata, str, datetime]] = []

    def publish(self, meta: InstanceMetadata, s3_key: str, received_at: datetime) -> None:
        if self.fail:
            raise RuntimeError("kafka down")
        self.events.append((meta, s3_key, received_at))


class FakeManifest:
    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []

    def append(self, row: dict[str, Any]) -> None:
        self.rows.append(row)


@pytest.fixture
def fake_deps() -> Dependencies:
    return Dependencies(
        store=FakeStore(),
        fhir=FakeFhir(),
        producer=FakeProducer(),
        manifest=FakeManifest(),
        imaging_bucket="imaging",
    )
