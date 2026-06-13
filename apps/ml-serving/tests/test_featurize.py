"""Vitals window featurization: grid shape, LOCF, imputation, normalization."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from medflow_serving.inference.featurize import (
    POPULATION_NORMALS,
    SEQUENCE_STEPS,
    VITALS_FEATURES,
    VitalsSample,
    flat_feature_names,
    impute_labs,
    normalize_sequence,
    resample_window,
)

T0 = datetime(2026, 6, 11, 12, 0, tzinfo=timezone.utc)


def sample(ts: datetime, hr: float = 80.0) -> VitalsSample:
    return VitalsSample(
        ts=ts, heart_rate=hr, spo2=97.0, resp_rate=16.0, temp_c=37.0, map_mmhg=85.0
    )


def test_grid_shape_is_24x5() -> None:
    grid = resample_window([sample(T0)])
    assert len(grid) == SEQUENCE_STEPS == 24
    assert all(len(row) == len(VITALS_FEATURES) == 5 for row in grid)


def test_empty_window_raises() -> None:
    with pytest.raises(ValueError, match="at least one sample"):
        resample_window([])


def test_leading_bins_use_population_normals() -> None:
    # One sample at the window end: every earlier bin is imputed.
    grid = resample_window([sample(T0, hr=120.0)], window_end=T0)
    hr_index = VITALS_FEATURES.index("heart_rate")
    assert grid[0][hr_index] == POPULATION_NORMALS["heart_rate"]
    assert grid[-1][hr_index] == 120.0


def test_last_observation_carried_forward() -> None:
    early = sample(T0 - timedelta(hours=5), hr=110.0)
    grid = resample_window([early, sample(T0, hr=70.0)], window_end=T0)
    hr_index = VITALS_FEATURES.index("heart_rate")
    hr_series = [row[hr_index] for row in grid]
    # After the early sample and before the final one, 110 is carried forward.
    assert 110.0 in hr_series[4:-1]
    assert hr_series[-1] == 70.0


def test_out_of_order_samples_are_sorted() -> None:
    later = sample(T0, hr=70.0)
    earlier = sample(T0 - timedelta(hours=1), hr=130.0)
    grid = resample_window([later, earlier], window_end=T0)
    hr_index = VITALS_FEATURES.index("heart_rate")
    assert grid[-1][hr_index] == 70.0  # latest wins at the final bin


def test_lab_imputation_order_and_defaults() -> None:
    vec = impute_labs({"wbc": 14.0, "lactate": None, "creatinine": None})
    assert vec == [14.0, POPULATION_NORMALS["lactate"], POPULATION_NORMALS["creatinine"]]


def test_normalization_zeroes_population_normals() -> None:
    grid = [[POPULATION_NORMALS[f] for f in VITALS_FEATURES]] * SEQUENCE_STEPS
    normalized = normalize_sequence(grid)
    assert all(abs(v) < 1e-9 for row in normalized for v in row)


def test_flat_feature_names_length_and_uniqueness() -> None:
    names = flat_feature_names()
    assert len(names) == SEQUENCE_STEPS * len(VITALS_FEATURES)
    assert len(set(names)) == len(names)
    assert names[-1].startswith("map_mmhg_t-0m")
