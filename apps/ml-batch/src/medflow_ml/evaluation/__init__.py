"""Model-evaluation helpers: discrimination, calibration, operating points,
and subgroup/fairness metrics. Numpy-only; no Spark."""

from __future__ import annotations

from medflow_ml.evaluation.metrics import (
    OperatingPoint,
    auprc,
    auroc,
    calibration_curve,
    expected_calibration_error,
    operating_point_metrics,
    sensitivity_specificity,
    subgroup_auroc,
)

__all__ = [
    "OperatingPoint",
    "auprc",
    "auroc",
    "calibration_curve",
    "expected_calibration_error",
    "operating_point_metrics",
    "sensitivity_specificity",
    "subgroup_auroc",
]
