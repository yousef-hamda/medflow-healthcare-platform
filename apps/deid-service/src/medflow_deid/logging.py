"""structlog JSON logging that never logs PHI values.

This service receives raw PHI by design, so the logging contract is stricter
than elsewhere in the platform: request/response bodies, free text, FHIR
resources and any identifier-shaped keys are scrubbed by a defensive processor
before rendering. Log *about* the data (lengths, entity-type counts, opaque
patient_id), never the data itself.
"""

from __future__ import annotations

import logging
from typing import Any

import structlog

PHI_KEYS: frozenset[str] = frozenset(
    {
        # payload-shaped keys: the de-identification inputs/outputs themselves
        "text",
        "raw",
        "body",
        "payload",
        "resource",
        "narrative",
        "div",
        # direct identifiers
        "name",
        "patient_name",
        "full_name",
        "given",
        "family",
        "mrn",
        "identifier",
        "dob",
        "birth_date",
        "birthdate",
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
