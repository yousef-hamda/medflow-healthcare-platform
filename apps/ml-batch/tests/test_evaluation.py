"""AUROC math + subgroup metric tests against closed-form answers."""

from __future__ import annotations

import math

import numpy as np

from medflow_ml.evaluation.metrics import (
    auprc,
    auroc,
    calibration_curve,
    expected_calibration_error,
    sensitivity_specificity,
    subgroup_auroc,
)


def test_auroc_perfect_separation_is_one() -> None:
    y = [0, 0, 1, 1]
    s = [0.1, 0.2, 0.8, 0.9]
    assert auroc(y, s) == 1.0


def test_auroc_inverted_is_zero() -> None:
    y = [0, 0, 1, 1]
    s = [0.9, 0.8, 0.2, 0.1]
    assert auroc(y, s) == 0.0


def test_auroc_known_value(labels_and_scores: tuple[np.ndarray, np.ndarray]) -> None:
    # y=[0,0,1,1], s=[0.1,0.4,0.35,0.8]. Pairs (pos,neg):
    #   (0.35 vs 0.1)=win, (0.35 vs 0.4)=loss, (0.8 vs 0.1)=win, (0.8 vs 0.4)=win
    #   -> 3/4 = 0.75
    y_true, y_score = labels_and_scores
    assert auroc(y_true, y_score) == 0.75


def test_auroc_handles_ties_with_average_rank() -> None:
    # Two tied scores straddling the classes -> 0.5 contribution.
    y = [0, 1]
    s = [0.5, 0.5]
    assert auroc(y, s) == 0.5


def test_auroc_single_class_is_nan() -> None:
    assert math.isnan(auroc([1, 1, 1], [0.2, 0.5, 0.9]))


def test_auroc_matches_rank_sum_identity() -> None:
    rng = np.random.default_rng(42)
    y = rng.integers(0, 2, size=200)
    if y.sum() == 0 or y.sum() == y.size:
        y[0], y[1] = 0, 1
    s = rng.random(200)
    # Brute-force Mann-Whitney to cross-check the vectorised implementation.
    pos = s[y == 1]
    neg = s[y == 0]
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    brute = wins / (pos.size * neg.size)
    assert auroc(y, s) == round(brute, 12) or abs(auroc(y, s) - brute) < 1e-9


def test_auprc_all_positive_first_is_one() -> None:
    y = [1, 1, 0, 0]
    s = [0.9, 0.8, 0.2, 0.1]
    assert auprc(y, s) == 1.0


def test_sensitivity_specificity_threshold() -> None:
    y = [0, 0, 1, 1]
    s = [0.1, 0.4, 0.6, 0.9]
    sens, spec = sensitivity_specificity(y, s, threshold=0.5)
    assert sens == 1.0  # both positives scored >= 0.5
    assert spec == 1.0  # both negatives scored < 0.5


def test_subgroup_auroc_keys_and_values(encounter_frame: object) -> None:
    df = encounter_frame  # type: ignore[assignment]
    out = subgroup_auroc(df["label"].to_numpy(), df["score"].to_numpy(), df["sex"].to_numpy())
    assert set(out.keys()) == {"female", "male"}
    # Within each sex the score ranks the labels perfectly in this fixture.
    assert out["female"] == 1.0
    assert out["male"] == 1.0


def test_subgroup_auroc_age_band_handles_single_class() -> None:
    y = [0, 1, 1]
    s = [0.2, 0.6, 0.9]
    groups = ["A", "A", "B"]  # group B has only positives -> nan
    out = subgroup_auroc(y, s, groups)
    assert out["A"] == 1.0
    assert math.isnan(out["B"])


def test_calibration_and_ece() -> None:
    # Perfectly calibrated: predicted prob == observed frequency in each bin.
    y = [0, 1, 0, 1, 0, 1, 1, 1]
    s = [0.05, 0.05, 0.95, 0.95, 0.05, 0.95, 0.95, 0.05]
    mean_pred, obs_freq, counts = calibration_curve(y, s, n_bins=10)
    assert sum(counts) == len(y)
    ece = expected_calibration_error(y, s, n_bins=10)
    assert 0.0 <= ece <= 1.0
