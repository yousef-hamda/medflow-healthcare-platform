"""Parquet manifest writer tests."""

from __future__ import annotations

import io
from typing import Any

import pyarrow.parquet as pq

from medflow_dicom.pipeline.manifest import MANIFEST_SCHEMA, ManifestWriter, append_row
from tests.conftest import FakeStore


def _row(instance: str = "1.1.1") -> dict[str, Any]:
    return {
        "patient_id": "PAT-1",
        "study_uid": "9.9.9",
        "series_uid": "9.9.9.1",
        "instance_uid": instance,
        "modality": "CT",
        "body_part": "CHEST",
        "study_date": "2026-01-05",
        "s3_key": f"PAT-1/9.9.9/{instance}.dcm",
        "preview_key": f"PAT-1/9.9.9/{instance}.preview.png",
        "received_at": "2026-01-05T10:00:00+00:00",
    }


def test_append_row_creates_manifest() -> None:
    data = append_row(None, _row())
    table = pq.read_table(io.BytesIO(data))
    assert table.num_rows == 1
    assert table.schema.names == MANIFEST_SCHEMA.names
    assert table.column("instance_uid").to_pylist() == ["1.1.1"]


def test_append_row_preserves_existing_rows() -> None:
    first = append_row(None, _row("1.1.1"))
    second = append_row(first, _row("2.2.2"))
    table = pq.read_table(io.BytesIO(second))
    assert table.num_rows == 2
    assert table.column("instance_uid").to_pylist() == ["1.1.1", "2.2.2"]


def test_manifest_writer_read_modify_write() -> None:
    store = FakeStore()
    writer = ManifestWriter(store, bucket="manifests", key="imaging.parquet")
    writer.append(_row("1.1.1"))
    writer.append(_row("2.2.2"))

    stored = store.objects[("manifests", "imaging.parquet")]
    table = pq.read_table(io.BytesIO(stored))
    assert table.num_rows == 2


def test_manifest_handles_missing_optional_values() -> None:
    row = _row()
    row["body_part"] = None
    data = append_row(None, row)
    table = pq.read_table(io.BytesIO(data))
    assert table.column("body_part").to_pylist() == [None]
