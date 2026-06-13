"""Canonical hashing for the append-only predictions log.

* ``canonical_json`` - deterministic serialization (sorted keys, compact
  separators) so the same logical payload always hashes identically.
* ``compute_input_hash`` - sha256 of the canonical request payload. Lets us
  prove what a prediction was computed from without storing identifiable
  feature values alongside an identity.
* ``chain_hash`` - tamper-evident hash chain: each row commits to the
  previous row's hash, so any retroactive edit breaks every later row
  (same WORM pattern the audit-service uses).
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

GENESIS_HASH = "0" * 64


def canonical_json(payload: Any) -> str:
    """Deterministic JSON: sorted keys, compact separators, no NaN."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str, allow_nan=False)


def compute_input_hash(payload: Any) -> str:
    """sha256 hex digest of the canonical JSON form of the request payload."""
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def chain_hash(prev_hash: str, row_payload: Any) -> str:
    """Next link of the tamper-evident chain: sha256(prev || canonical(row))."""
    body = f"{prev_hash}|{canonical_json(row_payload)}"
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def verify_chain(rows: list[dict[str, Any]], hash_key: str = "row_hash") -> bool:
    """Recompute the chain over rows (oldest first) and verify every link.

    Each row dict must carry its stored hash under ``hash_key``; all other
    keys are treated as the committed payload.
    """
    prev = GENESIS_HASH
    for row in rows:
        stored = row.get(hash_key)
        payload = {k: v for k, v in row.items() if k != hash_key}
        expected = chain_hash(prev, payload)
        if stored != expected:
            return False
        prev = expected
    return True
