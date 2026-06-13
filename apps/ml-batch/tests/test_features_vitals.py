"""Windowing and slope edge cases for the shared vitals featurizer.

Complements ``test_windowing.py`` with the trickier resample/slope/rolling
behaviours that are easy to get subtly wrong and that must match serving.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import pytest

from medflow_ml.features.vitals import (
    POPULATION_NORMALS,
    RESAMPLE_MINUTES,
    SEQUENCE_STEPS,
    VITALS_FEATURES,
    VitalsSample,
    resample_window,
    rolling_stats,
    slope_per_hour,
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


# ── slope_per_hour ───────────────────────────────────────────────────────────


def test_slope_single_point_is_zero() -> None:
    assert slope_per_hour([(datetime(2026, 6, 11, 12), 5.0)]) == 0.0


def test_slope_empty_is_zero() -> None:
    assert slope_per_hour([]) == 0.0


def test_slope_degenerate_zero_time_variance() -> None:
    # Two readings at the SAME timestamp -> zero x-variance -> slope 0.0.
    t = datetime(2026, 6, 11, 12)
    assert slope_per_hour([(t, 1.0), (t, 9.0)]) == 0.0


def test_slope_is_per_hour_units() -> None:
    t0 = datetime(2026, 6, 11, 12)
    # +10 over 2 hours == +5 per hour.
    points = [(t0, 100.0), (t0 + timedelta(hours=2), 110.0)]
    assert slope_per_hour(points) == pytest.approx(5.0)


def test_slope_negative_trend() -> None:
    t0 = datetime(2026, 6, 11, 12)
    points = [
        (t0, 100.0),
        (t0 + timedelta(hours=1), 90.0),
        (t0 + timedelta(hours=2), 80.0),
    ]
    assert slope_per_hour(points) == pytest.approx(-10.0)


def test_slope_is_order_invariant() -> None:
    t0 = datetime(2026, 6, 11, 12)
    a = [(t0, 100.0), (t0 + timedelta(hours=2), 110.0)]
    b = list(reversed(a))
    assert slope_per_hour(a) == pytest.approx(slope_per_hour(b))


# ── resample_window edge cases ───────────────────────────────────────────────


def test_resample_bin_spacing_is_resample_minutes() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    # Place one sample at each bin boundary; every bin should pick up its own.
    samples = [
        _sample(end - timedelta(minutes=RESAMPLE_MINUTES * (SEQUENCE_STEPS - 1 - i)),
                 heart_rate=float(100 + i))
        for i in range(SEQUENCE_STEPS)
    ]
    grid = resample_window(samples, window_end=end)
    hr_col = VITALS_FEATURES.index("heart_rate")
    assert [row[hr_col] for row in grid] == [float(100 + i) for i in range(SEQUENCE_STEPS)]


def test_resample_observation_at_bin_end_is_inclusive() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    # Sample exactly at the window end (last bin end) is included (<=).
    grid = resample_window([_sample(end, heart_rate=130.0)], window_end=end)
    hr_col = VITALS_FEATURES.index("heart_rate")
    assert grid[-1][hr_col] == 130.0


def test_resample_future_sample_does_not_affect_window() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    past = _sample(end - timedelta(hours=1), heart_rate=110.0)
    future = _sample(end + timedelta(hours=1), heart_rate=200.0)
    grid = resample_window([past, future], window_end=end)
    hr_col = VITALS_FEATURES.index("heart_rate")
    # The future value (200) must never appear inside the [.., end] grid.
    assert all(row[hr_col] != 200.0 for row in grid)
    assert grid[-1][hr_col] == 110.0


def test_resample_default_window_end_is_last_sample() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    grid_default = resample_window([_sample(end, heart_rate=111.0)])
    grid_explicit = resample_window([_sample(end, heart_rate=111.0)], window_end=end)
    assert grid_default == grid_explicit


def test_resample_all_columns_present_each_row() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    grid = resample_window([_sample(end)], window_end=end)
    assert all(len(row) == len(VITALS_FEATURES) for row in grid)
    # Leading bins for unobserved features fall back to population normals.
    assert grid[0][VITALS_FEATURES.index("spo2")] in (
        POPULATION_NORMALS["spo2"],
        97.0,
    )


# ── rolling_stats windowing ──────────────────────────────────────────────────


def test_rolling_stats_window_is_left_open_right_closed() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    # Point exactly at window start is EXCLUDED (start < ts), point at end INCLUDED.
    at_start = (end - timedelta(hours=6), 1.0)
    at_end = (end, 9.0)
    stats = rolling_stats([at_start, at_end], end, 6.0)
    assert stats["min"] == 9.0
    assert stats["max"] == 9.0
    assert stats["mean"] == pytest.approx(9.0)


def test_rolling_stats_mean_min_max() -> None:
    end = datetime(2026, 6, 11, 12, 0, 0)
    pts = [
        (end - timedelta(hours=5), 10.0),
        (end - timedelta(hours=3), 20.0),
        (end - timedelta(hours=1), 30.0),
    ]
    stats = rolling_stats(pts, end, 6.0)
    assert stats["min"] == 10.0
    assert stats["max"] == 30.0
    assert stats["mean"] == pytest.approx(20.0)
    assert stats["slope"] == pytest.approx(5.0)  # +20 over 4h == +5/h
