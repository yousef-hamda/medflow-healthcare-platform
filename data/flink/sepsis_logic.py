"""Pure, Flink-free sepsis-alerting logic.

Everything in this module is a deterministic function of its inputs so it can be
unit-tested without a running Flink/Kafka cluster (see ``tests/test_sepsis_logic.py``).
The PyFlink job (``sepsis_alerting.py``) is a thin wrapper that wires Kafka,
windowing and state around these functions and the ml-serving HTTP call.

Three responsibilities live here:

* :func:`window_features` — collapse a 6-hour window of vitals readings for one
  patient into the feature vector sent to ml-serving (and used by the fallback).
* :func:`news2_score` / :func:`news2_risk` — the NEWS2 early-warning score, used
  as the local fallback when ml-serving is unreachable, and to assign a coarse
  risk *band* for alert de-duplication.
* :func:`dedupe_decision` — keyed-state dedupe: decide whether a new alert should
  be emitted given the last alert we emitted for this patient.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

# ───────────────────────── constants / thresholds ─────────────────────────
#: Score at or above which we consider raising a sepsis alert.
SEPSIS_ALERT_THRESHOLD = 0.6

#: Suppress repeat alerts within this many seconds unless the risk band escalates.
DEDUPE_WINDOW_SECONDS = 30 * 60

#: A "meaningful" rise in score between consecutive evaluations.
RISING_EPSILON = 0.02

#: NEWS2 maps a 0-21 aggregate to a probability-like score by /21 (capped 1.0).
_NEWS2_MAX = 21.0

# Coarse risk bands used for de-dup escalation (NEWS2 clinical thresholds).
BAND_LOW = "low"          # NEWS2 0-4
BAND_MEDIUM = "medium"    # NEWS2 5-6 (or any single param == 3)
BAND_HIGH = "high"        # NEWS2 >= 7
_BAND_ORDER = {BAND_LOW: 0, BAND_MEDIUM: 1, BAND_HIGH: 2}


@dataclass
class VitalsReading:
    """One bedside vitals reading (subset relevant to NEWS2 / sepsis)."""

    patient_id: str
    event_time_ms: int
    heart_rate: Optional[float] = None
    resp_rate: Optional[float] = None
    spo2: Optional[float] = None
    temperature_c: Optional[float] = None
    systolic_bp: Optional[float] = None
    supplemental_o2: bool = False
    consciousness_avpu: str = "A"  # A=alert; V/P/U => not alert


@dataclass
class WindowFeatures:
    """Aggregated features for one patient over a window."""

    patient_id: str
    window_end_ms: int
    n_readings: int
    heart_rate_mean: Optional[float] = None
    heart_rate_max: Optional[float] = None
    resp_rate_mean: Optional[float] = None
    resp_rate_max: Optional[float] = None
    spo2_mean: Optional[float] = None
    spo2_min: Optional[float] = None
    temperature_mean: Optional[float] = None
    temperature_max: Optional[float] = None
    systolic_bp_mean: Optional[float] = None
    systolic_bp_min: Optional[float] = None
    supplemental_o2_any: bool = False
    consciousness_worst: str = "A"
    latest: Optional[VitalsReading] = field(default=None, repr=False)

    def to_serving_payload(self) -> Dict[str, object]:
        """The JSON body posted to ml-serving ``/predict/sepsis``."""
        return {
            "patient_id": self.patient_id,
            "window_end_ms": self.window_end_ms,
            "n_readings": self.n_readings,
            "heart_rate_mean": self.heart_rate_mean,
            "heart_rate_max": self.heart_rate_max,
            "resp_rate_mean": self.resp_rate_mean,
            "resp_rate_max": self.resp_rate_max,
            "spo2_mean": self.spo2_mean,
            "spo2_min": self.spo2_min,
            "temperature_mean": self.temperature_mean,
            "temperature_max": self.temperature_max,
            "systolic_bp_mean": self.systolic_bp_mean,
            "systolic_bp_min": self.systolic_bp_min,
            "supplemental_o2": self.supplemental_o2_any,
        }


def _mean(values: Sequence[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None


def _collect(readings: Sequence[VitalsReading], attr: str) -> List[float]:
    out: List[float] = []
    for r in readings:
        v = getattr(r, attr)
        if v is not None:
            out.append(float(v))
    return out


def window_features(
    patient_id: str, window_end_ms: int, readings: Sequence[VitalsReading]
) -> WindowFeatures:
    """Collapse a window of readings into a :class:`WindowFeatures` vector.

    Means/min/max are computed per metric ignoring missing values. The "worst"
    consciousness level (anything other than ``A`` is worse) and "any
    supplemental O2" flags are carried through for NEWS2.
    """
    ordered = sorted(readings, key=lambda r: r.event_time_ms)
    hr = _collect(ordered, "heart_rate")
    rr = _collect(ordered, "resp_rate")
    spo2 = _collect(ordered, "spo2")
    temp = _collect(ordered, "temperature_c")
    sbp = _collect(ordered, "systolic_bp")

    worst_conscious = "A"
    for r in ordered:
        if (r.consciousness_avpu or "A").upper() != "A":
            worst_conscious = (r.consciousness_avpu or "A").upper()

    return WindowFeatures(
        patient_id=patient_id,
        window_end_ms=window_end_ms,
        n_readings=len(ordered),
        heart_rate_mean=_mean(hr),
        heart_rate_max=max(hr) if hr else None,
        resp_rate_mean=_mean(rr),
        resp_rate_max=max(rr) if rr else None,
        spo2_mean=_mean(spo2),
        spo2_min=min(spo2) if spo2 else None,
        temperature_mean=_mean(temp),
        temperature_max=max(temp) if temp else None,
        systolic_bp_mean=_mean(sbp),
        systolic_bp_min=min(sbp) if sbp else None,
        supplemental_o2_any=any(r.supplemental_o2 for r in ordered),
        consciousness_worst=worst_conscious,
        latest=ordered[-1] if ordered else None,
    )


# ───────────────────────── NEWS2 sub-scores ─────────────────────────
def _score_resp_rate(rr: Optional[float]) -> int:
    if rr is None:
        return 0
    if rr <= 8:
        return 3
    if rr <= 11:
        return 1
    if rr <= 20:
        return 0
    if rr <= 24:
        return 2
    return 3


def _score_spo2(spo2: Optional[float]) -> int:
    # NEWS2 "Scale 1" SpO2 sub-score.
    if spo2 is None:
        return 0
    if spo2 <= 91:
        return 3
    if spo2 <= 93:
        return 2
    if spo2 <= 95:
        return 1
    return 0


def _score_supplemental_o2(on_o2: bool) -> int:
    return 2 if on_o2 else 0


def _score_temperature(temp_c: Optional[float]) -> int:
    if temp_c is None:
        return 0
    if temp_c <= 35.0:
        return 3
    if temp_c <= 36.0:
        return 1
    if temp_c <= 38.0:
        return 0
    if temp_c <= 39.0:
        return 1
    return 2


def _score_systolic_bp(sbp: Optional[float]) -> int:
    if sbp is None:
        return 0
    if sbp <= 90:
        return 3
    if sbp <= 100:
        return 2
    if sbp <= 110:
        return 1
    if sbp <= 219:
        return 0
    return 3


def _score_heart_rate(hr: Optional[float]) -> int:
    if hr is None:
        return 0
    if hr <= 40:
        return 3
    if hr <= 50:
        return 1
    if hr <= 90:
        return 0
    if hr <= 110:
        return 1
    if hr <= 130:
        return 2
    return 3


def _score_consciousness(avpu: str) -> int:
    # A (alert) => 0; anything else (V/P/U or "new confusion") => 3.
    return 0 if (avpu or "A").upper() == "A" else 3


@dataclass
class News2Result:
    total: int
    subscores: Dict[str, int]
    any_param_is_three: bool


def news2_subscores(
    *,
    heart_rate: Optional[float] = None,
    resp_rate: Optional[float] = None,
    spo2: Optional[float] = None,
    temperature_c: Optional[float] = None,
    systolic_bp: Optional[float] = None,
    supplemental_o2: bool = False,
    consciousness_avpu: str = "A",
) -> News2Result:
    """Compute the NEWS2 sub-scores and aggregate from raw physiology."""
    subs = {
        "resp_rate": _score_resp_rate(resp_rate),
        "spo2": _score_spo2(spo2),
        "supplemental_o2": _score_supplemental_o2(supplemental_o2),
        "temperature": _score_temperature(temperature_c),
        "systolic_bp": _score_systolic_bp(systolic_bp),
        "heart_rate": _score_heart_rate(heart_rate),
        "consciousness": _score_consciousness(consciousness_avpu),
    }
    total = sum(subs.values())
    # "supplemental_o2" is a binary 0/2 modifier, not a vital param itself.
    any_three = any(v == 3 for k, v in subs.items() if k != "supplemental_o2")
    return News2Result(total=total, subscores=subs, any_param_is_three=any_three)


def news2_from_features(features: WindowFeatures) -> News2Result:
    """Apply NEWS2 to a window using the most adverse value per parameter."""
    return news2_subscores(
        heart_rate=features.heart_rate_max,
        resp_rate=features.resp_rate_max,
        spo2=features.spo2_min,
        temperature_c=features.temperature_max,
        systolic_bp=features.systolic_bp_min,
        supplemental_o2=features.supplemental_o2_any,
        consciousness_avpu=features.consciousness_worst,
    )


def news2_score(features: WindowFeatures) -> float:
    """NEWS2 aggregate mapped to a 0-1 probability-like score (the fallback).

    ``total / 21`` is a monotone, bounded proxy used only when ml-serving is
    unreachable; at NEWS2 >= 7 (band high) this already exceeds the 0.6 alert
    threshold, matching the clinical "urgent response" trigger.
    """
    total = news2_from_features(features).total
    return min(total / _NEWS2_MAX, 1.0)


def news2_risk(result: News2Result) -> str:
    """Map a NEWS2 aggregate to a coarse risk band (low / medium / high)."""
    if result.total >= 7:
        return BAND_HIGH
    if result.total >= 5 or result.any_param_is_three:
        return BAND_MEDIUM
    return BAND_LOW


def band_for_score(score: float, features: WindowFeatures) -> str:
    """Risk band for a (possibly ml-served) score, blended with NEWS2 escalation.

    The model score sets a baseline band; a NEWS2 single-parameter ``3`` can only
    raise it. This keeps de-dup escalation faithful to clinical red flags even
    when the model is the score source.
    """
    if score >= 0.85:
        score_band = BAND_HIGH
    elif score >= SEPSIS_ALERT_THRESHOLD:
        score_band = BAND_MEDIUM
    else:
        score_band = BAND_LOW
    news_band = news2_risk(news2_from_features(features))
    return news_band if _BAND_ORDER[news_band] > _BAND_ORDER[score_band] else score_band


# ───────────────────────── alert de-duplication ─────────────────────────
@dataclass
class AlertState:
    """Per-patient keyed state retained between evaluations."""

    last_alert_time_ms: int
    last_score: float
    last_band: str


@dataclass
class DedupeDecision:
    emit: bool
    reason: str
    band: str


def dedupe_decision(
    *,
    score: float,
    band: str,
    event_time_ms: int,
    prev_score: Optional[float],
    state: Optional[AlertState],
    threshold: float = SEPSIS_ALERT_THRESHOLD,
    dedupe_seconds: int = DEDUPE_WINDOW_SECONDS,
    rising_epsilon: float = RISING_EPSILON,
) -> DedupeDecision:
    """Decide whether to emit an alert.

    Rules (in order):

    1. Below threshold → never alert.
    2. Score must be *rising* vs the previous evaluation (or this is the first
       evaluation, in which case crossing the threshold counts) — we alert on
       deterioration, not on a steady-state high reading.
    3. De-dup: if we already alerted for this patient within ``dedupe_seconds``,
       suppress the repeat *unless* the risk band has escalated.
    """
    if score < threshold:
        return DedupeDecision(emit=False, reason="below_threshold", band=band)

    rising = prev_score is None or (score - prev_score) >= rising_epsilon
    if not rising:
        return DedupeDecision(emit=False, reason="not_rising", band=band)

    if state is not None:
        within_window = (event_time_ms - state.last_alert_time_ms) < (
            dedupe_seconds * 1000
        )
        escalated = _BAND_ORDER[band] > _BAND_ORDER[state.last_band]
        if within_window and not escalated:
            return DedupeDecision(emit=False, reason="deduped", band=band)
        if within_window and escalated:
            return DedupeDecision(emit=True, reason="band_escalated", band=band)

    return DedupeDecision(emit=True, reason="new_alert", band=band)
