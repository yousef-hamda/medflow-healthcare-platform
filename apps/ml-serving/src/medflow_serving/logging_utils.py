"""Structured JSON logging and identifier hashing.

PHI policy: this module is the only sanctioned way to reference a patient
in logs or persisted rows. We never log raw patient identifiers, free-text
notes, or feature values that could be tied back to an identity - only the
salted one-way hash produced by :func:`hash_id`.
"""

from __future__ import annotations

import hashlib
import logging
import sys
from typing import Any

import structlog

_HASH_PREFIX_LEN = 16


def hash_id(raw_id: str, salt: str) -> str:
    """One-way salted SHA-256 hash of an identifier, truncated to 16 hex chars.

    Deterministic for a given (id, salt) pair so rows for the same patient can
    be correlated without ever storing the identifier itself.
    """
    digest = hashlib.sha256(f"{salt}:{raw_id}".encode()).hexdigest()
    return digest[:_HASH_PREFIX_LEN]


def configure_logging(level: int = logging.INFO) -> None:
    """Configure structlog to emit one JSON object per line on stdout."""
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str, **initial_values: Any) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name, **initial_values)  # type: ignore[no-any-return]
