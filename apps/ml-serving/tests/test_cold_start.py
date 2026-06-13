"""Cold-start fallback: deterministic, sane, monotone rule scores."""

from __future__ import annotations

from datetime import datetime, timezone

from medflow_serving.fallback.cold_start import (
    NIH_LABELS,
    readmission_rule_score,
    sepsis_rule_score,
    xray_rule_findings,
)
from medflow_serving.inference.featurize import VitalsSample

T0 = datetime(2026, 6, 11, 12, 0, tzinfo=timezone.utc)


def vitals(hr: float, spo2: float, rr: float, temp: float, map_: float) -> VitalsSample:
    return VitalsSample(
        ts=T0, heart_rate=hr, spo2=spo2, resp_rate=rr, temp_c=temp, map_mmhg=map_
    )


NORMAL = vitals(75, 98, 14, 37.0, 90)
SEPTIC = vitals(135, 88, 30, 39.5, 60)


def test_sepsis_score_bounded_and_deterministic() -> None:
    score = sepsis_rule_score(SEPTIC, {"lactate": 4.5, "wbc": 18.0})
    assert 0.0 <= score <= 1.0
    assert score == sepsis_rule_score(SEPTIC, {"lactate": 4.5, "wbc": 18.0})


def test_sepsis_score_orders_sick_above_healthy() -> None:
    healthy = sepsis_rule_score(NORMAL, {})
    septic = sepsis_rule_score(SEPTIC, {"lactate": 4.5, "wbc": 18.0})
    assert septic > healthy
    assert healthy < 0.3  # healthy patient lands in the low band
    assert septic >= 0.6  # florid sepsis lands in the high band


def test_sepsis_labs_increase_score() -> None:
    without = sepsis_rule_score(SEPTIC, {})
    with_labs = sepsis_rule_score(SEPTIC, {"lactate": 4.5, "wbc": 18.0})
    assert with_labs > without


def test_readmission_score_bounded_and_monotone_in_utilisation() -> None:
    low = readmission_rule_score(2.0, 0, 1, "home", True, 40)
    high = readmission_rule_score(12.0, 4, 8, "snf", False, 80)
    assert 0.0 <= low <= 1.0
    assert 0.0 <= high <= 1.0
    assert high > low


def test_readmission_social_support_is_protective() -> None:
    supported = readmission_rule_score(5.0, 2, 4, "home", True, 70)
    unsupported = readmission_rule_score(5.0, 2, 4, "home", False, 70)
    assert unsupported > supported


def test_xray_findings_cover_all_14_labels_deterministically() -> None:
    findings = xray_rule_findings()
    assert [label for label, _ in findings] == list(NIH_LABELS)
    assert len(findings) == 14
    assert all(0.0 < p < 0.5 for _, p in findings)
    assert findings == xray_rule_findings()
