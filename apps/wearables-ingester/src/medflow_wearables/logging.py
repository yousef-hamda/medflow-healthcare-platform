"""structlog JSON logging with PHI-key redaction.

Vitals values themselves are clinical measurements tied to an opaque
patient_id and may be logged at debug level; direct identifiers (names, MRN,
DOB, phone, email, address) must never appear and are scrubbed defensively.
"""

from __future__ import annotations

import logging
from typing import Any

import structlog

PHI_KEYS: frozenset[str] = frozenset(
    {
        "name",
        "patient_name",
        "full_name",
        "given",
        "family",
        "mrn",
        "dob",
        "birth_date",
        "birthdate",
        "phone",
        "phone_number",
        "email",
        "address",
        "street",
        "city",
        "postal_code",
        "zip",
        "ssn",
    }
)

REDACTED = "[REDACTED-PHI]"


def redact_phi(
    logger: logging.Logger, method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    for key in list(event_dict):
        if key.lower() in PHI_KEYS:
            event_dict[key] = REDACTED
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    logging.basicConfig(level=level.upper(), format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            redact_phi,
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)  # type: ignore[no-any-return]
