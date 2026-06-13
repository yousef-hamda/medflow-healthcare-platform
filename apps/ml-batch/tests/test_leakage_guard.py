"""Label-leakage guards.

The core safety property of the offline feature pipeline is that every feature
used to predict an outcome at time T is computed from data observed strictly
**before** T (or, for the prediction window, at-or-before T). These tests pin
that invariant for the vitals rolling windows, the resample grid and the
encounter prior-admission look-backs. If someone widens a window to peek into
the future, one of these fails.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from medflow_ml.features.encounters import prior_admission_counts
from medflow_ml.features.vitals import (
    VITALS_FEATURES,
    VitalsSample,
    resample_window,
    rolling_stats,
)


def _sample(ts: datetime, hr: float) -> VitalsSample:
    return VitalsSample(
        ts=ts, heart_rate=hr, spo2=97.0, resp_rate=16.0, temp_c=37.0, map_mmhg=85.0
    )


def test_rolling_stats_excludes_future_observations() -> None:
    pred_t = datetime(2026, 6, 11, 12, 0, 0)
    history = [(pred_t - timedelta(hours=2), 10.0), (pred_t - timedelta(hours=1), 12.0)]
    future = [(pred_t + timedelta(hours=1), 999.0)]
    with_future = rolling_stats(history + future, pred_t, 6.0)
    without_future = rolling_stats(history, pred_t, 6.0)
    # Adding a future point must NOT change any statistic.
    assert with_future == without_future
    assert with_future["max"] == 12.0  # the 999 future value never leaks in


def test_rolling_stats_window_end_is_inclusive_only_to_now() -> None:
    pred_t = datetime(2026, 6, 11, 12, 0, 0)
    # A point exactly at prediction time is allowed (the current observation).
    stats = rolling_stats([(pred_t, 7.0)], pred_t, 6.0)
    assert stats["mean"] == 7.0
    # One microsecond into the future is not.
    leaked = rolling_stats([(pred_t + timedelta(microseconds=1), 7.0)], pred_t, 6.0)
    assert leaked == {}


def test_resample_window_never_uses_post_window_samples() -> None:
    pred_t = datetime(2026, 6, 11, 12, 0, 0)
    in_window = _sample(pred_t - timedelta(minutes=30), hr=120.0)
    after = _sample(pred_t + timedelta(minutes=30), hr=200.0)
    grid = resample_window([in_window, after], window_end=pred_t)
    hr_col = VITALS_FEATURES.index("heart_rate")
    assert all(row[hr_col] != 200.0 for row in grid)


def test_prior_admission_counts_exclude_index_and_future() -> None:
    index = date(2026, 6, 11)
    prior = [
        index - timedelta(days=10),   # counts (within 90d)
        index - timedelta(days=100),  # counts only for 180/365d
        index,                        # the index admission itself - EXCLUDED
        index + timedelta(days=5),    # a FUTURE admission - EXCLUDED
    ]
    counts = prior_admission_counts(prior, index)
    assert counts["prior_admissions_90d"] == 1
    assert counts["prior_admissions_180d"] == 2
    assert counts["prior_admissions_365d"] == 2


def test_prior_admission_counts_boundary_is_left_closed_right_open() -> None:
    index = date(2026, 6, 11)
    # Exactly 90 days before is INCLUDED (index - 90 <= d); index itself EXCLUDED.
    at_lower = index - timedelta(days=90)
    counts = prior_admission_counts([at_lower, index], index)
    assert counts["prior_admissions_90d"] == 1
