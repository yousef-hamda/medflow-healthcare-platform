"""structlog JSON logging.

PHI safety: a dedicated processor redacts any log key that could carry PHI
(names, MRN, DOB, phone, email, address). Only opaque identifiers (UIDs,
PatientID) and type/code metadata may be logged.
"""

from __future__ import annotations

import logging
from typing import Any

import structlog

# Keys that must never reach a log sink with their original value.
PHI_KEYS: frozenset[str] = frozenset(
    {
        "patient_name",
        "patientname",
        "name",
        "given",
        "family",
        "full_name",
        "mrn",
        "dob",
        "birth_date",
        "birthdate",
        "patient_birth_date",
        "phone",
        "phone_number",
        "telecom",
        "email",
        "address",
        "street",
        "city",
        "postal_code",
        "zip",
        "ssn",
        "text",
        "note",
    }
)

REDACTED = "[REDACTED-PHI]"


def redact_phi(
    logger: logging.Logger, method_name: str, event_dict: dict[str, Any]
) -> dict[str, Any]:
    """Replace the value of any PHI-looking key with a redaction marker."""
    for key in list(event_dict):
        if key.lower() in PHI_KEYS:
            event_dict[key] = REDACTED
    return event_dict


def configure_logging(level: str = "INFO") -> None:
    """Configure structlog to emit one JSON object per line on stdout."""
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
