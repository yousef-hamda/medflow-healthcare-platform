"""Deterministic rule-based "cold start" scorers.

Served when the MLflow registry has no model yet (fresh environment before
any training job ran) so the whole stack works on first ``make dev``.

These rules are intentionally simple, fully deterministic, and documented:

* **Sepsis** - a normalized NEWS2-inspired early-warning score over the most
  recent vitals sample plus lactate/WBC bumps. NOT a clinical tool; it only
  exists to exercise the API contract end-to-end.
* **Readmission** - a LACE-flavoured heuristic (Length of stay, Acuity proxy,
  Comorbidity count, prior ED/admissions) squashed to a probability.
* **Chest X-ray** - fixed low background prevalences for the 14 NIH labels
  (no image is actually analysed in cold-start mode).

Every response produced in this mode carries
``model_version = "cold-start-rules-v1"`` so downstream consumers and the
predictions log can never confuse rule scores with model scores.
"""

from __future__ import annotations

from medflow_serving.inference.featurize import VitalsSample

COLD_START_VERSION = "cold-start-rules-v1"

NIH_LABELS = (
    "Atelectasis",
    "Cardiomegaly",
    "Effusion",
    "Infiltration",
    "Mass",
    "Nodule",
    "Pneumonia",
    "Pneumothorax",
    "Consolidation",
    "Edema",
    "Emphysema",
    "Fibrosis",
    "Pleural_Thickening",
    "Hernia",
)

# Approximate label prevalence in ChestX-ray14 train split, used as the
# deterministic cold-start "probability" per finding.
_XRAY_BACKGROUND = {
    "Atelectasis": 0.103,
    "Cardiomegaly": 0.025,
    "Effusion": 0.119,
    "Infiltration": 0.177,
    "Mass": 0.051,
    "Nodule": 0.056,
    "Pneumonia": 0.013,
    "Pneumothorax": 0.047,
    "Consolidation": 0.042,
    "Edema": 0.021,
    "Emphysema": 0.022,
    "Fibrosis": 0.015,
    "Pleural_Thickening": 0.030,
    "Hernia": 0.002,
}


def _band_points(value: float, bands: list[tuple[float, int]]) -> int:
    """Points for the first (threshold, points) band the value reaches."""
    for threshold, points in bands:
        if value >= threshold:
            return points
    return 0


def sepsis_rule_score(latest: VitalsSample, labs: dict[str, float | None]) -> float:
    """NEWS2-inspired early-warning score normalized to [0, 1].

    Scores the most recent vitals sample; max raw score considered is 16.
    """
    points = 0
    # Respiratory rate
    points += _band_points(latest.resp_rate, [(25.0, 3), (21.0, 2)])
    if latest.resp_rate <= 8.0:
        points += 3
    # SpO2 (lower is worse)
    if latest.spo2 <= 91.0:
        points += 3
    elif latest.spo2 <= 93.0:
        points += 2
    elif latest.spo2 <= 95.0:
        points += 1
    # Temperature
    if latest.temp_c >= 39.1 or latest.temp_c <= 35.0:
        points += 2
    elif latest.temp_c >= 38.1:
        points += 1
    # Heart rate
    points += _band_points(latest.heart_rate, [(131.0, 3), (111.0, 2), (91.0, 1)])
    if latest.heart_rate <= 40.0:
        points += 3
    # Mean arterial pressure (hypotension)
    if latest.map_mmhg <= 65.0:
        points += 3
    elif latest.map_mmhg <= 75.0:
        points += 1
    # Labs
    lactate = labs.get("lactate")
    if lactate is not None and lactate >= 4.0:
        points += 3
    elif lactate is not None and lactate >= 2.0:
        points += 2
    wbc = labs.get("wbc")
    if wbc is not None and (wbc >= 12.0 or wbc <= 4.0):
        points += 1

    return min(points / 16.0, 1.0)


def readmission_rule_score(
    length_of_stay_days: float,
    prior_admissions_365d: int,
    n_diagnoses: int,
    discharge_disposition: str,
    has_social_support: bool,
    age: int,
) -> float:
    """LACE-flavoured heuristic squashed to [0, 1]."""
    score = 0.0
    score += min(length_of_stay_days, 14.0) / 14.0 * 3.0  # L
    score += min(prior_admissions_365d, 4) / 4.0 * 4.0  # E (prior utilisation)
    score += min(n_diagnoses, 6) / 6.0 * 3.0  # C (comorbidity proxy)
    if discharge_disposition not in ("home", "home_health"):
        score += 1.5
    if not has_social_support:
        score += 1.0
    if age >= 75:
        score += 1.0
    elif age >= 65:
        score += 0.5
    return min(score / 14.0, 1.0)


def xray_rule_findings() -> list[tuple[str, float]]:
    """Fixed background prevalences for the 14 NIH labels (deterministic)."""
    return [(label, _XRAY_BACKGROUND[label]) for label in NIH_LABELS]
