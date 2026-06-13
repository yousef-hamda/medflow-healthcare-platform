"""Flink-free unit tests for ``sepsis_logic``.

These exercise the pure window-feature, NEWS2 and de-duplication functions so
the alerting behaviour is validated without a Flink/Kafka cluster. Run with::

    cd data/flink && python -m pytest tests/ -q
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sepsis_logic import (  # noqa: E402
    BAND_HIGH,
    BAND_LOW,
    BAND_MEDIUM,
    AlertState,
    DEDUPE_WINDOW_SECONDS,
    SEPSIS_ALERT_THRESHOLD,
    VitalsReading,
    band_for_score,
    dedupe_decision,
    news2_from_features,
    news2_risk,
    news2_score,
    news2_subscores,
    window_features,
)

MIN = 60 * 1000


def _reading(t_min: int, **kw) -> VitalsReading:
    return VitalsReading(patient_id="p1", event_time_ms=t_min * MIN, **kw)


# ───────────────────────── window_features ─────────────────────────
def test_window_features_aggregates_mean_min_max():
    readings = [
        _reading(0, heart_rate=80, spo2=98, temperature_c=37.0, systolic_bp=120),
        _reading(15, heart_rate=120, spo2=92, temperature_c=39.5, systolic_bp=95),
        _reading(30, heart_rate=100, spo2=96, temperature_c=38.0, systolic_bp=110),
    ]
    f = window_features("p1", 30 * MIN, readings)
    assert f.n_readings == 3
    assert f.heart_rate_max == 120
    assert abs(f.heart_rate_mean - 100.0) < 1e-9
    assert f.spo2_min == 92
    assert f.temperature_max == 39.5
    assert f.systolic_bp_min == 95
    assert f.latest.event_time_ms == 30 * MIN  # ordered by time


def test_window_features_handles_missing_values():
    readings = [_reading(0, heart_rate=88), _reading(5, spo2=97)]
    f = window_features("p1", 5 * MIN, readings)
    assert f.heart_rate_mean == 88
    assert f.spo2_mean == 97
    assert f.temperature_mean is None
    assert f.systolic_bp_min is None


def test_window_features_worst_consciousness_and_o2():
    readings = [
        _reading(0, consciousness_avpu="A", supplemental_o2=False),
        _reading(5, consciousness_avpu="V", supplemental_o2=True),
    ]
    f = window_features("p1", 5 * MIN, readings)
    assert f.consciousness_worst == "V"
    assert f.supplemental_o2_any is True


# ───────────────────────── NEWS2 sub-scores ─────────────────────────
def test_news2_normal_vitals_score_zero():
    r = news2_subscores(
        heart_rate=75, resp_rate=16, spo2=98, temperature_c=37.0, systolic_bp=120
    )
    assert r.total == 0
    assert not r.any_param_is_three


def test_news2_subscore_boundaries():
    # RR sub-scores
    assert news2_subscores(resp_rate=8).subscores["resp_rate"] == 3
    assert news2_subscores(resp_rate=9).subscores["resp_rate"] == 1
    assert news2_subscores(resp_rate=18).subscores["resp_rate"] == 0
    assert news2_subscores(resp_rate=22).subscores["resp_rate"] == 2
    assert news2_subscores(resp_rate=25).subscores["resp_rate"] == 3
    # SpO2 (scale 1)
    assert news2_subscores(spo2=90).subscores["spo2"] == 3
    assert news2_subscores(spo2=92).subscores["spo2"] == 2
    assert news2_subscores(spo2=94).subscores["spo2"] == 1
    assert news2_subscores(spo2=97).subscores["spo2"] == 0
    # Temperature
    assert news2_subscores(temperature_c=34.9).subscores["temperature"] == 3
    assert news2_subscores(temperature_c=35.5).subscores["temperature"] == 1
    assert news2_subscores(temperature_c=37.0).subscores["temperature"] == 0
    assert news2_subscores(temperature_c=38.5).subscores["temperature"] == 1
    assert news2_subscores(temperature_c=39.5).subscores["temperature"] == 2
    # Systolic BP
    assert news2_subscores(systolic_bp=85).subscores["systolic_bp"] == 3
    assert news2_subscores(systolic_bp=95).subscores["systolic_bp"] == 2
    assert news2_subscores(systolic_bp=105).subscores["systolic_bp"] == 1
    assert news2_subscores(systolic_bp=120).subscores["systolic_bp"] == 0
    assert news2_subscores(systolic_bp=230).subscores["systolic_bp"] == 3
    # Heart rate
    assert news2_subscores(heart_rate=39).subscores["heart_rate"] == 3
    assert news2_subscores(heart_rate=45).subscores["heart_rate"] == 1
    assert news2_subscores(heart_rate=75).subscores["heart_rate"] == 0
    assert news2_subscores(heart_rate=100).subscores["heart_rate"] == 1
    assert news2_subscores(heart_rate=120).subscores["heart_rate"] == 2
    assert news2_subscores(heart_rate=140).subscores["heart_rate"] == 3


def test_news2_supplemental_o2_and_consciousness():
    r = news2_subscores(supplemental_o2=True, consciousness_avpu="P")
    assert r.subscores["supplemental_o2"] == 2
    assert r.subscores["consciousness"] == 3


def test_news2_septic_patient_high_total():
    # RR 28(3) + SpO2 90(3) + O2(2) + T 39.5(2) + SBP 88(3) + HR 125(2) + A(0)
    r = news2_subscores(
        heart_rate=125,
        resp_rate=28,
        spo2=90,
        temperature_c=39.5,
        systolic_bp=88,
        supplemental_o2=True,
        consciousness_avpu="A",
    )
    assert r.total == 15
    assert r.any_param_is_three
    assert news2_risk(r) == BAND_HIGH


def test_news2_risk_bands():
    assert news2_risk(news2_subscores()) == BAND_LOW
    # single param == 3 forces medium even if total < 5
    assert news2_risk(news2_subscores(spo2=90)) == BAND_MEDIUM
    # total 5 (HR 2 + RR 2 + temp 1), no single param == 3 -> medium
    assert (
        news2_risk(news2_subscores(heart_rate=125, resp_rate=22, temperature_c=38.5))
        == BAND_MEDIUM
    )
    assert news2_risk(news2_subscores(resp_rate=28, spo2=90, systolic_bp=88)) == BAND_HIGH


def test_news2_score_fallback_monotone_and_bounded():
    healthy = window_features(
        "p1", 0, [_reading(0, heart_rate=70, resp_rate=14, spo2=99, temperature_c=37.0, systolic_bp=120)]
    )
    septic = window_features(
        "p1", 0, [_reading(0, heart_rate=130, resp_rate=30, spo2=88, temperature_c=40.0, systolic_bp=85, supplemental_o2=True)]
    )
    assert news2_score(healthy) == 0.0
    assert news2_score(septic) > SEPSIS_ALERT_THRESHOLD
    assert news2_score(septic) <= 1.0


def test_band_for_score_news2_can_escalate():
    # Low model score but a NEWS2 single-3 red flag pulls the band up.
    feats = window_features("p1", 0, [_reading(0, spo2=90)])
    assert band_for_score(0.1, feats) == BAND_MEDIUM
    high_feats = window_features(
        "p1", 0, [_reading(0, resp_rate=28, spo2=90, systolic_bp=88)]
    )
    assert band_for_score(0.65, high_feats) == BAND_HIGH


# ───────────────────────── dedupe_decision ─────────────────────────
def test_dedupe_below_threshold_never_emits():
    d = dedupe_decision(
        score=0.3, band=BAND_LOW, event_time_ms=0, prev_score=None, state=None
    )
    assert not d.emit and d.reason == "below_threshold"


def test_dedupe_requires_rising_score():
    d = dedupe_decision(
        score=0.7, band=BAND_MEDIUM, event_time_ms=10 * MIN, prev_score=0.71, state=None
    )
    assert not d.emit and d.reason == "not_rising"


def test_dedupe_first_crossing_emits():
    d = dedupe_decision(
        score=0.7, band=BAND_MEDIUM, event_time_ms=0, prev_score=None, state=None
    )
    assert d.emit and d.reason == "new_alert"


def test_dedupe_suppresses_repeat_within_window():
    state = AlertState(last_alert_time_ms=0, last_score=0.7, last_band=BAND_MEDIUM)
    d = dedupe_decision(
        score=0.75,
        band=BAND_MEDIUM,
        event_time_ms=10 * MIN,  # within 30 min
        prev_score=0.7,
        state=state,
    )
    assert not d.emit and d.reason == "deduped"


def test_dedupe_emits_on_band_escalation_within_window():
    state = AlertState(last_alert_time_ms=0, last_score=0.7, last_band=BAND_MEDIUM)
    d = dedupe_decision(
        score=0.9,
        band=BAND_HIGH,
        event_time_ms=10 * MIN,
        prev_score=0.7,
        state=state,
    )
    assert d.emit and d.reason == "band_escalated"


def test_dedupe_emits_after_window_elapses():
    state = AlertState(last_alert_time_ms=0, last_score=0.7, last_band=BAND_MEDIUM)
    after = (DEDUPE_WINDOW_SECONDS + 60) * 1000
    d = dedupe_decision(
        score=0.75, band=BAND_MEDIUM, event_time_ms=after, prev_score=0.7, state=state
    )
    assert d.emit and d.reason == "new_alert"


if __name__ == "__main__":
    import pytest

    raise SystemExit(pytest.main([__file__, "-q"]))
