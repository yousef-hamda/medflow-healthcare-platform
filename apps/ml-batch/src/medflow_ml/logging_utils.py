"""structlog setup for batch jobs (JSON lines to stdout, UTC timestamps).

Mirrors apps/ml-serving/src/medflow_serving/logging_utils.py conventions:
raw patient identifiers are never logged - jobs log only counts, dates and
salted hashes when an identifier is unavoidable.
"""

from __future__ import annotations

import hashlib
import logging
import os
import sys

import structlog


def configure_logging(job: str) -> structlog.stdlib.BoundLogger:
    """Configure structlog once per process and return a job-bound logger."""
    logging.basicConfig(stream=sys.stdout, format="%(message)s", level=logging.INFO)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )
    return structlog.get_logger().bind(job=job)


def hash_id(raw_id: str) -> str:
    """One-way salted hash for patient/encounter ids in logs. Never log raw ids."""
    salt = os.environ.get("HASH_SALT", "medflow-dev-hash-salt")
    return hashlib.sha256(f"{salt}:{raw_id}".encode()).hexdigest()[:16]
