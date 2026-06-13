"""Discrimination, calibration and subgroup metrics (numpy only).

These re-implement AUROC/AUPRC etc. directly (rather than calling sklearn)
so they are unit-testable with known closed-form answers and have no heavy
import cost. The training jobs may additionally log sklearn/torchmetrics
values; these helpers back the notebooks and the subgroup fairness tables.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def _as_arrays(y_true: object, y_score: object) -> tuple[np.ndarray, np.ndarray]:
    yt = np.asarray(y_true, dtype=np.float64).reshape(-1)
    ys = np.asarray(y_score, dtype=np.float64).reshape(-1)
    if yt.shape != ys.shape:
        raise ValueError(f"shape mismatch: {yt.shape} vs {ys.shape}")
    if yt.size == 0:
        raise ValueError("empty inputs")
    return yt, ys


def auroc(y_true: object, y_score: object) -> float:
    """Area under the ROC curve via the rank-sum (Mann-Whitney U) identity.

    Returns ``nan`` when only one class is present (AUROC undefined).
    """
    yt, ys = _as_arrays(y_true, y_score)
    pos = yt == 1
    n_pos = int(pos.sum())
    n_neg = int((~pos).sum())
    if n_pos == 0 or n_neg == 0:
        return float("nan")
    order = np.argsort(ys, kind="mergesort")
    ranks = np.empty_like(order, dtype=np.float64)
    ranks[order] = np.arange(1, ys.size + 1, dtype=np.float64)
    # Average ranks within tied score groups.
    _assign_tied_ranks(ys, ranks)
    sum_pos = ranks[pos].sum()
    return float((sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg))


def _assign_tied_ranks(scores: np.ndarray, ranks: np.ndarray) -> None:
    order = np.argsort(scores, kind="mergesort")
    sorted_scores = scores[order]
    i = 0
    n = sorted_scores.size
    while i < n:
        j = i + 1
        while j < n and sorted_scores[j] == sorted_scores[i]:
            j += 1
        if j - i > 1:
            avg = (np.arange(i + 1, j + 1)).mean()
            ranks[order[i:j]] = avg
        i = j


def auprc(y_true: object, y_score: object) -> float:
    """Average precision (area under the precision-recall curve)."""
    yt, ys = _as_arrays(y_true, y_score)
    n_pos = int((yt == 1).sum())
    if n_pos == 0:
        return float("nan")
    order = np.argsort(-ys, kind="mergesort")
    yt_sorted = yt[order]
    tp = np.cumsum(yt_sorted)
    fp = np.cumsum(1.0 - yt_sorted)
    precision = tp / np.maximum(tp + fp, 1e-12)
    recall = tp / n_pos
    # Average precision = sum over thresholds of (recall_k - recall_{k-1}) * precision_k.
    prev_recall = 0.0
    ap = 0.0
    for k in range(yt_sorted.size):
        if yt_sorted[k] == 1:
            ap += (recall[k] - prev_recall) * precision[k]
            prev_recall = recall[k]
    return float(ap)


def sensitivity_specificity(
    y_true: object, y_score: object, threshold: float
) -> tuple[float, float]:
    """Sensitivity (recall) and specificity at a probability ``threshold``."""
    yt, ys = _as_arrays(y_true, y_score)
    pred = ys >= threshold
    pos = yt == 1
    tp = float((pred & pos).sum())
    fn = float((~pred & pos).sum())
    tn = float((~pred & ~pos).sum())
    fp = float((pred & ~pos).sum())
    sens = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
    spec = tn / (tn + fp) if (tn + fp) > 0 else float("nan")
    return sens, spec


@dataclass(frozen=True)
class OperatingPoint:
    threshold: float
    sensitivity: float
    specificity: float
    ppv: float
    npv: float
    alert_rate: float


def operating_point_metrics(
    y_true: object, y_score: object, thresholds: list[float]
) -> list[OperatingPoint]:
    """Sens/spec/PPV/NPV/alert-rate at each operating threshold."""
    yt, ys = _as_arrays(y_true, y_score)
    pos = yt == 1
    points: list[OperatingPoint] = []
    for thr in thresholds:
        pred = ys >= thr
        tp = float((pred & pos).sum())
        fp = float((pred & ~pos).sum())
        tn = float((~pred & ~pos).sum())
        fn = float((~pred & pos).sum())
        sens = tp / (tp + fn) if (tp + fn) > 0 else float("nan")
        spec = tn / (tn + fp) if (tn + fp) > 0 else float("nan")
        ppv = tp / (tp + fp) if (tp + fp) > 0 else float("nan")
        npv = tn / (tn + fn) if (tn + fn) > 0 else float("nan")
        alert_rate = float(pred.mean())
        points.append(OperatingPoint(thr, sens, spec, ppv, npv, alert_rate))
    return points


def calibration_curve(
    y_true: object, y_score: object, n_bins: int = 10
) -> tuple[list[float], list[float], list[int]]:
    """Reliability curve: (mean predicted, observed frequency, count) per bin.

    Equal-width bins on [0, 1]; empty bins are omitted.
    """
    yt, ys = _as_arrays(y_true, y_score)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    mean_pred: list[float] = []
    obs_freq: list[float] = []
    counts: list[int] = []
    for b in range(n_bins):
        lo, hi = edges[b], edges[b + 1]
        mask = (ys >= lo) & (ys < hi) if b < n_bins - 1 else (ys >= lo) & (ys <= hi)
        if not mask.any():
            continue
        mean_pred.append(float(ys[mask].mean()))
        obs_freq.append(float(yt[mask].mean()))
        counts.append(int(mask.sum()))
    return mean_pred, obs_freq, counts


def expected_calibration_error(y_true: object, y_score: object, n_bins: int = 10) -> float:
    """ECE: count-weighted mean |observed - predicted| over calibration bins."""
    mean_pred, obs_freq, counts = calibration_curve(y_true, y_score, n_bins)
    total = sum(counts)
    if total == 0:
        return float("nan")
    return float(
        sum(c * abs(o - p) for o, p, c in zip(obs_freq, mean_pred, counts)) / total
    )


def subgroup_auroc(
    y_true: object, y_score: object, groups: object
) -> dict[str, float]:
    """AUROC computed within each subgroup label (sex/age-band/race)."""
    yt, ys = _as_arrays(y_true, y_score)
    grp = np.asarray(groups).reshape(-1)
    if grp.shape != yt.shape:
        raise ValueError("groups must align with labels")
    out: dict[str, float] = {}
    for label in sorted({str(g) for g in grp}):
        mask = grp.astype(str) == label
        out[label] = auroc(yt[mask], ys[mask])
    return out
