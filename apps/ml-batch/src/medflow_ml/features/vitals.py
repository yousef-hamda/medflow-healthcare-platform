"""Vitals windowing, resampling, rolling stats and slope - pure functions.

This module is the **training-time source of truth** mirrored at serving
time by ``medflow_serving.inference.featurize``. The two must stay
byte-for-byte consistent on:

* ``WINDOW_HOURS`` / ``RESAMPLE_MINUTES`` / ``SEQUENCE_STEPS`` (6h, 15min, 24)
* ``VITALS_FEATURES`` / ``LAB_FEATURES`` column order
* ``POPULATION_NORMALS`` imputation values
* the z-score scales in :func:`normalize_sequence`

No Spark or pandas imports - Spark jobs wrap these in ``mapInPandas``.
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
# MUST match medflow_serving.inference.featurize.POPULATION_NORMALS.
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

# Fixed clinical z-score scales. MUST match the serving-side constants.
NORMALIZATION_SCALES: dict[str, float] = {
    "heart_rate": 20.0,
    "spo2": 4.0,
    "resp_rate": 5.0,
    "temp_c": 0.8,
    "map_mmhg": 15.0,
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

    Identical to ``medflow_serving.inference.featurize.resample_window``.
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
    out: list[float] = []
    for name in LAB_FEATURES:
        value = labs.get(name)
        out.append(float(value) if value is not None else POPULATION_NORMALS[name])
    return out


def normalize_sequence(grid: list[list[float]]) -> list[list[float]]:
    """Z-score the grid against population normals with fixed clinical scales.

    Scales match serving-time constants so training and serving agree.
    """
    out: list[list[float]] = []
    for row in grid:
        out.append(
            [
                (value - POPULATION_NORMALS[feat]) / NORMALIZATION_SCALES[feat]
                for feat, value in zip(VITALS_FEATURES, row)
            ]
        )
    return out


def slope_per_hour(points: list[tuple[datetime, float]]) -> float:
    """Least-squares slope of a value series in units **per hour**.

    Returns 0.0 for fewer than two points or a degenerate (zero time
    variance) series. Used for rolling-window trend features such as
    ``heart_rate_slope_6h``.
    """
    if len(points) < 2:
        return 0.0
    ordered = sorted(points, key=lambda p: p[0])
    t0 = ordered[0][0]
    xs = [(ts - t0).total_seconds() / 3600.0 for ts, _ in ordered]
    ys = [float(v) for _, v in ordered]
    n = float(len(xs))
    mean_x = sum(xs) / n
    mean_y = sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    if sxx == 0.0:
        return 0.0
    sxy = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    return sxy / sxx


def rolling_stats(
    points: list[tuple[datetime, float]],
    window_end: datetime,
    window_hours: float,
) -> dict[str, float]:
    """``mean``/``min``/``max``/``slope`` over ``(window_end - h, window_end]``.

    Only observations with ``window_end - window_hours < ts <= window_end``
    participate - the window is **strictly historical** relative to
    ``window_end`` (the prediction time), which is what the label-leakage
    guard test asserts. Empty windows return an empty dict so callers can
    fall back to population normals explicitly.
    """
    start = window_end - timedelta(hours=window_hours)
    in_window = [(ts, float(v)) for ts, v in points if start < ts <= window_end]
    if not in_window:
        return {}
    values = [v for _, v in in_window]
    return {
        "mean": sum(values) / len(values),
        "min": min(values),
        "max": max(values),
        "slope": slope_per_hour(in_window),
    }


def flat_feature_names() -> list[str]:
    """Names for the flattened [step x feature] sequence (for SHAP display)."""
    return [
        f"{feat}_t-{(SEQUENCE_STEPS - 1 - step) * RESAMPLE_MINUTES}m"
        for step in range(SEQUENCE_STEPS)
        for feat in VITALS_FEATURES
    ]
