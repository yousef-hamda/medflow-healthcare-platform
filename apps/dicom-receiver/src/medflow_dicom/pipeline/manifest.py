"""Imaging manifest: a Parquet file at ``manifests/imaging.parquet``.

The manifest is maintained read-modify-write: download the current Parquet
file, append one row, upload the result. A process-local lock serialises
writers inside this service; see the README for the ETag-based
compare-and-swap note that would be required with multiple replicas.
"""

from __future__ import annotations

import io
import threading
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
import structlog

from medflow_dicom.storage.minio_client import ObjectStore

log = structlog.get_logger(__name__)

MANIFEST_SCHEMA = pa.schema(
    [
        pa.field("patient_id", pa.string()),
        pa.field("study_uid", pa.string()),
        pa.field("series_uid", pa.string()),
        pa.field("instance_uid", pa.string()),
        pa.field("modality", pa.string()),
        pa.field("body_part", pa.string()),
        pa.field("study_date", pa.string()),
        pa.field("s3_key", pa.string()),
        pa.field("preview_key", pa.string()),
        pa.field("received_at", pa.string()),
    ]
)


def _row_table(row: dict[str, Any]) -> pa.Table:
    columns = {name: [row.get(name)] for name in MANIFEST_SCHEMA.names}
    return pa.table(columns, schema=MANIFEST_SCHEMA)


def append_row(existing: bytes | None, row: dict[str, Any]) -> bytes:
    """Append one row to a (possibly absent) serialized Parquet manifest."""
    new_table = _row_table(row)
    if existing:
        current = pq.read_table(io.BytesIO(existing))
        combined = pa.concat_tables([current.cast(MANIFEST_SCHEMA), new_table])
    else:
        combined = new_table

    buf = io.BytesIO()
    pq.write_table(combined, buf, compression="zstd")
    return buf.getvalue()


class ManifestWriter:
    def __init__(
        self,
        store: ObjectStore,
        bucket: str = "manifests",
        key: str = "imaging.parquet",
    ) -> None:
        self._store = store
        self._bucket = bucket
        self._key = key
        self._lock = threading.Lock()

    def append(self, row: dict[str, Any]) -> None:
        with self._lock:
            existing = self._store.get_bytes(self._bucket, self._key)
            updated = append_row(existing, row)
            etag = self._store.put_bytes(
                self._bucket, self._key, updated, content_type="application/vnd.apache.parquet"
            )
        log.info("manifest_appended", bucket=self._bucket, key=self._key, etag=etag)
