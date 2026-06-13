"""Canary split: determinism, distribution, and gating logic."""

from __future__ import annotations

from medflow_serving.registry.canary import (
    CanaryConfig,
    ModelTrack,
    canary_bucket,
    resolve_track,
)


def test_bucket_is_deterministic() -> None:
    for pid in ("synthea-0001", "synthea-0002", "x"):
        assert canary_bucket(pid) == canary_bucket(pid)


def test_bucket_in_range() -> None:
    assert all(0 <= canary_bucket(f"p-{i}") < 100 for i in range(1000))


def test_same_patient_always_same_track() -> None:
    config = CanaryConfig(enabled=True, canary_version="7", percent=30)
    tracks = {resolve_track("synthea-0042", config) for _ in range(50)}
    assert len(tracks) == 1


def test_split_roughly_matches_percent() -> None:
    config = CanaryConfig(enabled=True, canary_version="7", percent=20)
    n = 5000
    canary = sum(
        1 for i in range(n) if resolve_track(f"patient-{i}", config) is ModelTrack.CANARY
    )
    assert 0.15 < canary / n < 0.25  # 20% +/- 5pp over 5000 ids


def test_disabled_routes_everything_stable() -> None:
    config = CanaryConfig(enabled=False, canary_version="7", percent=100)
    assert all(
        resolve_track(f"p-{i}", config) is ModelTrack.STABLE for i in range(100)
    )


def test_missing_canary_version_routes_stable() -> None:
    config = CanaryConfig(enabled=True, canary_version=None, percent=100)
    assert resolve_track("anyone", config) is ModelTrack.STABLE


def test_zero_percent_routes_stable() -> None:
    config = CanaryConfig(enabled=True, canary_version="3", percent=0)
    assert all(resolve_track(f"p-{i}", config) is ModelTrack.STABLE for i in range(100))
