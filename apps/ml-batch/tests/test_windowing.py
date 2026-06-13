"""Windowing/resampling edge cases for the shared vitals featurizer."""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from medflow_ml.features.vitals import (
    POPULATION_NORMALS,
    SEQUENCE_STEPS,
    VITALS_FEATURES,
    VitalsSample,
    impute_labs,
    normalize_sequence,
    resample_window,
    rolling_stats,
)


def _sample(ts: datetime, **kw: float) -> VitalsSample:
    base = {
        "heart_rate": 80.0,
        "spo2": 97.0,
        "resp_rate": 16.0,
        "temp_c": 37.0,
        "map_mmhg": 85.0,
    }
    base.update(kw)
    return VitalsSample(ts=ts, **base)  # type: ignore[arg-type]


def test_resample_window_shape_is_24_by_5() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    grid = resample_window([_sample(end, heart_rate=120.0)], window_end=end)
    assert len(grid) == SEQUENCE_STEPS
    assert all(len(row) == len(VITALS_FEATURES) for row in grid)


def test_empty_window_raises() -> None:
    with pytest.raises(ValueError, match="at least one sample"):
        resample_window([])


def test_leading_gap_imputed_with_population_normals() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    # Only one late sample -> early bins fall back to population normals.
    grid = resample_window([_sample(end, heart_rate=120.0)], window_end=end)
    assert grid[0][0] == POPULATION_NORMALS["heart_rate"]
    # Last bin reflects the observed value (LOCF).
    assert grid[-1][0] == 120.0


def test_locf_carries_last_observation_forward() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    early = _sample(end - timedelta(hours=3), heart_rate=100.0)
    grid = resample_window([early], window_end=end)
    # After the observation every later bin keeps 100.0.
    assert grid[-1][0] == 100.0


def test_resample_matches_serving_constants() -> None:
    # 6h window at 15-min resolution must be 24 steps.
    assert SEQUENCE_STEPS == 24


def test_normalize_sequence_centers_population_normal_to_zero() -> None:
    grid = [[POPULATION_NORMALS[f] for f in VITALS_FEATURES]]
    norm = normalize_sequence(grid)
    assert all(abs(v) < 1e-9 for v in norm[0])


def test_impute_labs_fixed_order_and_fallback() -> None:
    vec = impute_labs({"wbc": 14.0, "lactate": None})
    assert vec[0] == 14.0
    assert vec[1] == POPULATION_NORMALS["lactate"]
    assert vec[2] == POPULATION_NORMALS["creatinine"]


def test_rolling_stats_empty_window_returns_empty() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    series = [(end - timedelta(hours=10), 5.0)]
    assert rolling_stats(series, end, 6.0) == {}
