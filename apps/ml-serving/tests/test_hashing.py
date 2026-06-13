"""Predictions-row hashing: canonical form, input hash, tamper-evident chain."""

from __future__ import annotations

from medflow_serving.logging_utils import hash_id
from medflow_serving.persistence.hashing import (
    GENESIS_HASH,
    canonical_json,
    chain_hash,
    compute_input_hash,
    verify_chain,
)


def test_canonical_json_is_key_order_independent() -> None:
    a = {"b": 1, "a": {"y": 2, "x": 3}}
    b = {"a": {"x": 3, "y": 2}, "b": 1}
    assert canonical_json(a) == canonical_json(b)


def test_input_hash_is_deterministic_and_sensitive() -> None:
    payload = {"patient_id": "p1", "labs": {"lactate": 2.0}}
    assert compute_input_hash(payload) == compute_input_hash(dict(payload))
    changed = {"patient_id": "p1", "labs": {"lactate": 2.1}}
    assert compute_input_hash(payload) != compute_input_hash(changed)


def test_chain_hash_depends_on_previous_link() -> None:
    row = {"model": "sepsis-ews", "latency_ms": 12}
    assert chain_hash(GENESIS_HASH, row) != chain_hash("a" * 64, row)


def _make_chain(payloads: list[dict[str, object]]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    prev = GENESIS_HASH
    for payload in payloads:
        link = chain_hash(prev, payload)
        rows.append({**payload, "row_hash": link})
        prev = link
    return rows


def test_verify_chain_accepts_untampered_rows() -> None:
    rows = _make_chain([{"model": "m", "n": i} for i in range(5)])
    assert verify_chain(rows)


def test_verify_chain_detects_payload_tampering() -> None:
    rows = _make_chain([{"model": "m", "n": i} for i in range(5)])
    rows[2]["n"] = 999  # retroactive edit
    assert not verify_chain(rows)


def test_verify_chain_detects_deleted_row() -> None:
    rows = _make_chain([{"model": "m", "n": i} for i in range(5)])
    del rows[1]
    assert not verify_chain(rows)


def test_hash_id_never_contains_raw_id_and_is_salted() -> None:
    hashed = hash_id("patient-12345", salt="s1")
    assert "patient-12345" not in hashed
    assert len(hashed) == 16
    assert hashed == hash_id("patient-12345", salt="s1")
    assert hashed != hash_id("patient-12345", salt="s2")
