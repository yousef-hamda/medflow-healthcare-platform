"""Deterministic canary traffic splitting.

A patient is assigned to the canary track by a stable hash of their
patient_id, so repeated requests for the same patient always hit the same
model version (no flip-flopping risk scores between calls), and the split
is reproducible across replicas without shared state.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from enum import Enum

_BUCKETS = 100


class ModelTrack(str, Enum):
    STABLE = "stable"
    CANARY = "canary"


@dataclass(frozen=True)
class CanaryConfig:
    enabled: bool
    canary_version: str | None
    percent: int  # 0..100 share of traffic routed to canary


def canary_bucket(patient_id: str) -> int:
    """Stable bucket in [0, 100) derived from sha256(patient_id).

    Uses the first 8 bytes of the digest as a big-endian integer; this is
    uniform across buckets and independent of Python's randomized str hash.
    """
    digest = hashlib.sha256(patient_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % _BUCKETS


def resolve_track(patient_id: str, config: CanaryConfig) -> ModelTrack:
    """Decide which model track serves this patient."""
    if not config.enabled or not config.canary_version or config.percent <= 0:
        return ModelTrack.STABLE
    if canary_bucket(patient_id) < config.percent:
        return ModelTrack.CANARY
    return ModelTrack.STABLE
