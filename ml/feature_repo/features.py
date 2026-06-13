"""Feast feature views for MedFlow (Feast 0.36+ API, synthetic data only).

These mirror the offline parquet written by
``medflow_ml.jobs.backfill_features``: rolling vitals statistics over 1h/6h/24h
windows, encounter history counts, and lab abnormality flags. Every feature is
computed from data strictly prior to its event timestamp, so point-in-time
joins are leakage-free.

Field names/dtypes here MUST match the columns produced by the backfill job and
consumed by the serving featurizer. All values are derived from SYNTHETIC data
(Synthea, seed 42); the lab flag set follows
``medflow_ml.features.labs.lab_flag_field_names()``.
"""

from __future__ import annotations

from datetime import timedelta

from feast import FeatureView, Field, FileSource
from feast.types import Float32, Int64

from entities import patient

# ── Sources (offline parquet in the MinIO lakehouse feature store) ───────────
# The backfill job writes s3://lakehouse/feature_store/<name>.parquet; for local
# Feast `apply`/`materialize` runs these can be a local mirror of the same data.

vitals_stats_source = FileSource(
    name="vitals_stats_source",
    path="data/feature_store/vitals_stats.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_timestamp",
)

encounter_history_source = FileSource(
    name="encounter_history_source",
    path="data/feature_store/encounter_history.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_timestamp",
)

lab_flags_source = FileSource(
    name="lab_flags_source",
    path="data/feature_store/lab_flags.parquet",
    timestamp_field="event_timestamp",
    created_timestamp_column="created_timestamp",
)


def _vitals_window_fields(window: str) -> list[Field]:
    """mean/min/max/slope for each vital over a named rolling window."""
    vitals = ("heart_rate", "spo2", "resp_rate", "temp_c", "map_mmhg")
    stats = ("mean", "min", "max", "slope")
    return [
        Field(name=f"{vital}_{stat}_{window}", dtype=Float32)
        for vital in vitals
        for stat in stats
    ]


# ── Vitals rolling statistics (1h / 6h / 24h) ────────────────────────────────

vitals_stats_1h = FeatureView(
    name="vitals_stats_1h",
    entities=[patient],
    ttl=timedelta(hours=6),
    schema=_vitals_window_fields("1h"),
    source=vitals_stats_source,
    online=True,
    tags={"team": "ml", "data": "synthetic", "window": "1h"},
)

vitals_stats_6h = FeatureView(
    name="vitals_stats_6h",
    entities=[patient],
    ttl=timedelta(hours=12),
    schema=_vitals_window_fields("6h"),
    source=vitals_stats_source,
    online=True,
    tags={"team": "ml", "data": "synthetic", "window": "6h"},
)

vitals_stats_24h = FeatureView(
    name="vitals_stats_24h",
    entities=[patient],
    ttl=timedelta(hours=48),
    schema=_vitals_window_fields("24h"),
    source=vitals_stats_source,
    online=True,
    tags={"team": "ml", "data": "synthetic", "window": "24h"},
)

# ── Encounter history (prior admission counts, LOS, diagnoses) ───────────────

encounter_history = FeatureView(
    name="encounter_history",
    entities=[patient],
    ttl=timedelta(days=365),
    schema=[
        Field(name="prior_admissions_90d", dtype=Int64),
        Field(name="prior_admissions_180d", dtype=Int64),
        Field(name="prior_admissions_365d", dtype=Int64),
        Field(name="length_of_stay_days", dtype=Float32),
        Field(name="n_diagnoses", dtype=Int64),
        Field(name="age", dtype=Int64),
    ],
    source=encounter_history_source,
    online=True,
    tags={"team": "ml", "data": "synthetic"},
)

# ── Lab abnormality flags (vs adult reference ranges) ────────────────────────
# Field set follows medflow_ml.features.labs.lab_flag_field_names():
# for each lab in {wbc, lactate, creatinine, sodium, potassium, hemoglobin,
# platelets, bilirubin}: {lab}_low / {lab}_high / {lab}_abnormal.

_LAB_NAMES = (
    "wbc",
    "lactate",
    "creatinine",
    "sodium",
    "potassium",
    "hemoglobin",
    "platelets",
    "bilirubin",
)

lab_flags = FeatureView(
    name="lab_flags",
    entities=[patient],
    ttl=timedelta(hours=72),
    schema=[
        Field(name=f"{lab}_{kind}", dtype=Int64)
        for lab in _LAB_NAMES
        for kind in ("low", "high", "abnormal")
    ],
    source=lab_flags_source,
    online=True,
    tags={"team": "ml", "data": "synthetic"},
)
