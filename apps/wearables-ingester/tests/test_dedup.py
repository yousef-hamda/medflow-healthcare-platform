"""Duplicate-suppression tests: LRU cache semantics and repo-level contract."""

from __future__ import annotations

import pytest

from medflow_wearables.db import DedupCache

from .conftest import FakeRepo, make_reading


def test_first_sighting_is_not_seen() -> None:
    cache = DedupCache(max_size=10)
    assert cache.seen(("p1", "t1")) is False
    assert cache.seen(("p1", "t1")) is True


def test_distinct_keys_do_not_collide() -> None:
    cache = DedupCache(max_size=10)
    assert cache.seen(("p1", "t1")) is False
    assert cache.seen(("p1", "t2")) is False
    assert cache.seen(("p2", "t1")) is False


def test_lru_eviction_forgets_oldest() -> None:
    cache = DedupCache(max_size=2)
    cache.seen("a")
    cache.seen("b")
    cache.seen("c")  # evicts "a"
    assert len(cache) == 2
    assert cache.seen("c") is True  # newest still present
    assert cache.seen("a") is False  # oldest was forgotten


def test_recently_touched_key_survives_eviction() -> None:
    cache = DedupCache(max_size=2)
    cache.seen("a")
    cache.seen("b")
    cache.seen("a")  # touch -> "a" most recent
    cache.seen("c")  # should evict "b", not "a"
    assert cache.seen("a") is True
    assert cache.seen("b") is False


def test_invalid_max_size_rejected() -> None:
    with pytest.raises(ValueError):
        DedupCache(max_size=0)


async def test_repo_contract_same_patient_ts_is_duplicate() -> None:
    repo = FakeRepo()
    reading = make_reading()
    assert await repo.insert(reading) is True
    assert await repo.insert(reading) is False
    assert await repo.insert(make_reading(ts="2026-06-01T12:01:00+00:00")) is True
    assert len(repo.readings) == 2
