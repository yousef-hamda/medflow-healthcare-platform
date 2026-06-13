"""Delta / S3 read-write helpers.

* :mod:`medflow_ml.data_io.spark_io` - Spark session + conf builder for
  ``s3a://`` Delta paths (distributed jobs).
* :mod:`medflow_ml.data_io.delta_io` - delta-rs (``deltalake``) helpers for
  pandas-scale ``s3://`` paths (feature backfill, baselines).
"""

from __future__ import annotations

from medflow_ml.data_io.delta_io import (
    read_delta_pandas,
    read_parquet_pandas,
    write_delta_pandas,
    write_parquet_pandas,
)
from medflow_ml.data_io.spark_io import build_spark_conf, read_delta_spark, stop_spark, write_delta_spark

__all__ = [
    "build_spark_conf",
    "read_delta_pandas",
    "read_delta_spark",
    "read_parquet_pandas",
    "stop_spark",
    "write_delta_pandas",
    "write_delta_spark",
    "write_parquet_pandas",
]
