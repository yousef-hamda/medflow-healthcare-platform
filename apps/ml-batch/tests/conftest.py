"""Shared synthetic fixtures for the ml-batch unit tests.

Everything here is SYNTHETIC and tiny - no PHI, no network, no Spark. The
frames mimic the shape of the gold tables / feature rows the jobs operate on
so the pure feature and evaluation functions can be exercised in isolation.
"""

from __future__ import annotations

from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import pytest

SEED = 42


@pytest.fixture
def rng() -> np.random.Generator:
    """Deterministic generator (seed 42) so fixtures are reproducible."""
    return np.random.default_rng(SEED)


@pytest.fixture
def prediction_time() -> datetime:
    """A fixed 'now' / prediction timestamp used across leakage tests."""
    return datetime(2026, 6, 11, 12, 0, 0)


@pytest.fixture
def vitals_frame(prediction_time: datetime) -> pd.DataFrame:
    """Synthetic irregular vitals for two patients spanning a 10h history.

    Columns: patient_id, ts, heart_rate, spo2, resp_rate, temp_c, map_mmhg.
    Some rows fall AFTER ``prediction_time`` on purpose so leakage tests can
    assert they are excluded.
    """
    rows: list[dict[str, object]] = []
    for pid in ("p1", "p2"):
        base_hr = 80.0 if pid == "p1" else 95.0
        for hours_ago in (9, 6, 3, 1, 0, -1):  # -1 == one hour in the FUTURE
            ts = prediction_time - timedelta(hours=hours_ago)
            rows.append(
                {
                    "patient_id": pid,
                    "ts": ts,
                    "heart_rate": base_hr + hours_ago,
                    "spo2": 97.0 - 0.2 * hours_ago,
                    "resp_rate": 16.0 + 0.1 * hours_ago,
                    "temp_c": 37.0 + 0.05 * hours_ago,
                    "map_mmhg": 85.0 - 0.5 * hours_ago,
                }
            )
    return pd.DataFrame(rows)


@pytest.fixture
def encounter_frame() -> pd.DataFrame:
    """Synthetic readmission cohort rows with subgroup columns.

    Columns mirror the engineered readmission feature row plus the protected
    attributes (sex, age_band, race) used for subgroup fairness tables, plus a
    binary label and a model score.
    """
    return pd.DataFrame(
        {
            "patient_id": [f"e{i}" for i in range(8)],
            "age": [34, 71, 58, 80, 45, 67, 29, 76],
            "sex": ["female", "male", "female", "male", "female", "male", "female", "male"],
            "race": ["white", "black", "asian", "white", "black", "white", "asian", "black"],
            "length_of_stay_days": [2.0, 9.0, 4.0, 12.0, 1.0, 6.0, 3.0, 8.0],
            "prior_admissions_365d": [0, 3, 1, 4, 0, 2, 0, 3],
            "n_diagnoses": [2, 7, 4, 9, 1, 5, 2, 8],
            "label": [0, 1, 0, 1, 0, 1, 0, 1],
            "score": [0.10, 0.82, 0.30, 0.77, 0.05, 0.61, 0.20, 0.70],
        }
    )


@pytest.fixture
def labels_and_scores() -> tuple[np.ndarray, np.ndarray]:
    """A small (label, score) pair with a hand-computable AUROC."""
    y_true = np.array([0, 0, 1, 1], dtype=np.float64)
    y_score = np.array([0.1, 0.4, 0.35, 0.8], dtype=np.float64)
    return y_true, y_score
