"""Thin wrapper around the MinIO SDK used by the SCP and the pipeline."""

from __future__ import annotations

import io
from urllib.parse import urlparse

import structlog
from minio import Minio
from minio.error import S3Error

log = structlog.get_logger(__name__)


class ObjectStore:
    """Synchronous MinIO client (the pynetdicom SCP handlers run in threads)."""

    def __init__(self, endpoint: str, access_key: str, secret_key: str) -> None:
        parsed = urlparse(endpoint)
        host = parsed.netloc or parsed.path  # tolerate "minio:9000" without scheme
        self._client = Minio(
            host,
            access_key=access_key,
            secret_key=secret_key,
            secure=parsed.scheme == "https",
        )

    def ensure_bucket(self, bucket: str) -> None:
        if not self._client.bucket_exists(bucket):
            self._client.make_bucket(bucket)
            log.info("bucket_created", bucket=bucket)

    def put_bytes(
        self,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str | None:
        """Upload bytes; returns the new object ETag."""
        result = self._client.put_object(
            bucket, key, io.BytesIO(data), length=len(data), content_type=content_type
        )
        return getattr(result, "etag", None)

    def get_bytes(self, bucket: str, key: str) -> bytes | None:
        """Download an object, or None if it does not exist."""
        response = None
        try:
            response = self._client.get_object(bucket, key)
            return bytes(response.read())
        except S3Error as exc:
            if exc.code in {"NoSuchKey", "NoSuchBucket"}:
                return None
            raise
        finally:
            if response is not None:
                response.close()
                response.release_conn()
