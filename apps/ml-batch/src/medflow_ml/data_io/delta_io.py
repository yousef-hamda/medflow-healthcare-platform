"""delta-rs (``deltalake``) + pandas helpers for ``s3://`` paths.

Used by jobs that operate at pandas scale (feature backfill, drift
baselines) where spinning up a JVM is unnecessary. ``deltalake``,
``pandas`` and ``pyarrow`` are imported lazily so the pure modules stay
import-light.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from medflow_ml.config import Settings, get_settings

if TYPE_CHECKING:  # pragma: no cover - typing only
    import pandas as pd


def storage_options(settings: Settings | None = None) -> dict[str, str]:
    """S3 storage options dict for delta-rs / pyarrow fs against MinIO."""
    cfg = settings or get_settings()
    return {
        "AWS_ENDPOINT_URL": cfg.s3_endpoint_url,
        "AWS_ACCESS_KEY_ID": cfg.aws_access_key_id,
        "AWS_SECRET_ACCESS_KEY": cfg.aws_secret_access_key,
        "AWS_REGION": cfg.aws_region,
        "AWS_ALLOW_HTTP": "true",
        "AWS_S3_ALLOW_UNSAFE_RENAME": "true",
    }


def read_delta_pandas(
    table_uri: str, columns: list[str] | None = None, settings: Settings | None = None
) -> pd.DataFrame:
    """Read a Delta table by ``s3://`` URI into a pandas DataFrame."""
    from deltalake import DeltaTable  # noqa: PLC0415

    table = DeltaTable(table_uri, storage_options=storage_options(settings))
    return table.to_pandas(columns=columns)


def write_delta_pandas(
    df: pd.DataFrame,
    table_uri: str,
    mode: str = "overwrite",
    partition_by: list[str] | None = None,
    settings: Settings | None = None,
) -> None:
    """Write a pandas DataFrame as a Delta table to ``s3://`` URI."""
    from deltalake import write_deltalake  # noqa: PLC0415

    write_deltalake(
        table_uri,
        df,
        mode=mode,  # type: ignore[arg-type]
        partition_by=partition_by,
        storage_options=storage_options(settings),
    )


def read_parquet_pandas(uri: str, settings: Settings | None = None) -> pd.DataFrame:
    """Read a parquet dataset by ``s3://`` URI into pandas (via pyarrow/s3fs)."""
    import pandas as pd  # noqa: PLC0415

    return pd.read_parquet(uri, storage_options=_fsspec_options(settings))


def write_parquet_pandas(
    df: pd.DataFrame, uri: str, settings: Settings | None = None
) -> None:
    """Write a pandas DataFrame to a parquet ``s3://`` URI (via pyarrow/s3fs)."""
    df.to_parquet(uri, index=False, storage_options=_fsspec_options(settings))


def _fsspec_options(settings: Settings | None) -> dict[str, Any]:
    cfg = settings or get_settings()
    return {
        "key": cfg.aws_access_key_id,
        "secret": cfg.aws_secret_access_key,
        "client_kwargs": {"endpoint_url": cfg.s3_endpoint_url},
    }
