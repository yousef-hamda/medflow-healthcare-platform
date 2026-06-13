"""Pure-function feature engineering (no Spark, no pandas imports).

Everything here is dependency-free Python so that:

* the same logic is auditable against the serving side
  (``medflow_serving.inference.featurize`` mirrors :mod:`medflow_ml.features.vitals``),
* unit tests run with the standard library only,
* Spark jobs apply these functions inside ``mapInPandas``/UDF wrappers
  without dragging Spark into the feature definitions themselves.
"""

from __future__ import annotations

from medflow_ml.features.encounters import (
    AGE_BANDS,
    COMORBIDITY_PREFIXES,
    FEATURE_ORDER,
    age_band,
    comorbidity_flags,
    encounter_feature_row,
    prior_admission_counts,
)
from medflow_ml.features.labs import LAB_REFERENCE_RANGES, lab_abnormality_flags
from medflow_ml.features.vitals import (
    LAB_FEATURES,
    POPULATION_NORMALS,
    RESAMPLE_MINUTES,
    SEQUENCE_STEPS,
    VITALS_FEATURES,
    WINDOW_HOURS,
    VitalsSample,
    impute_labs,
    normalize_sequence,
    resample_window,
    rolling_stats,
    slope_per_hour,
)

__all__ = [
    "AGE_BANDS",
    "COMORBIDITY_PREFIXES",
    "FEATURE_ORDER",
    "LAB_FEATURES",
    "LAB_REFERENCE_RANGES",
    "POPULATION_NORMALS",
    "RESAMPLE_MINUTES",
    "SEQUENCE_STEPS",
    "VITALS_FEATURES",
    "WINDOW_HOURS",
    "VitalsSample",
    "age_band",
    "comorbidity_flags",
    "encounter_feature_row",
    "impute_labs",
    "lab_abnormality_flags",
    "normalize_sequence",
    "prior_admission_counts",
    "resample_window",
    "rolling_stats",
    "slope_per_hour",
]
