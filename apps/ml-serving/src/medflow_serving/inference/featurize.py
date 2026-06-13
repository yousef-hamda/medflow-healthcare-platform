"""Pure-function featurization for the sepsis vitals window.

Mirrors the training-time pipeline in ``medflow_ml.features.vitals``:
a 6-hour observation window resampled onto a 15-minute grid (24 steps),
forward-filled, with population normals used to seed leading gaps.

Everything here is dependency-free pure Python so it is trivially
unit-testable and identical logic can be audited against the batch side.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

WINDOW_HOURS = 6
RESAMPLE_MINUTES = 15
SEQUENCE_STEPS = WINDOW_HOURS * 60 // RESAMPLE_MINUTES  # 24

VITALS_FEATURES = ("heart_rate", "spo2", "resp_rate", "temp_c", "map_mmhg")
LAB_FEATURES = ("wbc", "lactate", "creatinine")

# Population normals used to impute values never observed in the window.
POPULATION_NORMALS: dict[str, float] = {
    "heart_rate": 80.0,
    "spo2": 97.0,
    "resp_rate": 16.0,
    "temp_c": 37.0,
    "map_mmhg": 85.0,
    "wbc": 7.5,
    "lactate": 1.0,
    "creatinine": 0.9,
}


@dataclass(frozen=True)
class VitalsSample:
    ts: datetime
    heart_rate: float
    spo2: float
    resp_rate: float
    temp_c: float
    map_mmhg: float

    def value(self, feature: str) -> float:
        return float(getattr(self, feature))


def resample_window(
    samples: list[VitalsSample],
    window_end: datetime | None = None,
) -> list[list[float]]:
    """Resample irregular vitals onto a fixed [24 x 5] grid.

    For each 15-minute bin the **last observation at or before the bin end**
    wins (last-observation-carried-forward). Bins before the first
    observation are imputed with population normals. Output row order is
    oldest -> newest; column order is :data:`VITALS_FEATURES`.
    """
    if not samples:
        raise ValueError("vitals window must contain at least one sample")

    ordered = sorted(samples, key=lambda s: s.ts)
    end = window_end or ordered[-1].ts
    step = timedelta(minutes=RESAMPLE_MINUTES)
    bin_ends = [end - step * (SEQUENCE_STEPS - 1 - i) for i in range(SEQUENCE_STEPS)]

    grid: list[list[float]] = []
    last_seen: dict[str, float] = {}
    idx = 0
    for bin_end in bin_ends:
        while idx < len(ordered) and ordered[idx].ts <= bin_end:
            for feature in VITALS_FEATURES:
                last_seen[feature] = ordered[idx].value(feature)
            idx += 1
        grid.append(
            [last_seen.get(feature, POPULATION_NORMALS[feature]) for feature in VITALS_FEATURES]
        )
    return grid


def impute_labs(labs: dict[str, float | None]) -> list[float]:
    """Fixed-order lab vector with population-normal imputation for missing labs."""
    return [
        float(labs[name]) if labs.get(name) is not None else POPULATION_NORMALS[name]  # type: ignore[arg-type]
        for name in LAB_FEATURES
    ]


def normalize_sequence(grid: list[list[float]]) -> list[list[float]]:
    """Z-score the grid against population normals with fixed clinical scales.

    Scales match training-time constants so serving and training agree.
    """
    scales = {"heart_rate": 20.0, "spo2": 4.0, "resp_rate": 5.0, "temp_c": 0.8, "map_mmhg": 15.0}
    out: list[list[float]] = []
    for row in grid:
        out.append(
            [
                (value - POPULATION_NORMALS[feat]) / scales[feat]
                for feat, value in zip(VITALS_FEATURES, row, strict=True)
            ]
        )
    return out


def flat_feature_names() -> list[str]:
    """Names for the flattened [step x feature] sequence (for SHAP display)."""
    return [
        f"{feat}_t-{(SEQUENCE_STEPS - 1 - step) * RESAMPLE_MINUTES}m"
        for step in range(SEQUENCE_STEPS)
        for feat in VITALS_FEATURES
    ]
