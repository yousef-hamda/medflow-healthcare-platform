"""Logging contract: the logger never emits PHI values.

This service handles raw PHI by design, so the logging processor must scrub
any payload- or identifier-shaped key before rendering.
"""

from __future__ import annotations

import json

from medflow_deid.logging import REDACTED, configure_logging, get_logger, redact_phi


def test_redact_phi_scrubs_known_keys() -> None:
    event = {
        "event": "deidentify",
        "text": "Patient John Doe, MRN 1234567",
        "name": "John Doe",
        "mrn": "1234567",
        "patient_id": "pat-1",  # opaque id — allowed
        "count": 3,
    }
    out = redact_phi(None, "info", dict(event))  # type: ignore[arg-type]
    assert out["text"] == REDACTED
    assert out["name"] == REDACTED
    assert out["mrn"] == REDACTED
    # Non-PHI structural fields survive.
    assert out["patient_id"] == "pat-1"
    assert out["count"] == 3


def test_redact_is_case_insensitive() -> None:
    out = redact_phi(None, "info", {"Resource": "secret", "BirthDate": "1985-07-14"})  # type: ignore[arg-type]
    assert out["Resource"] == REDACTED
    assert out["BirthDate"] == REDACTED


def test_configured_logger_does_not_emit_phi(capsys) -> None:  # type: ignore[no-untyped-def]
    configure_logging("INFO")
    log = get_logger("test")
    log.info(
        "deidentify",
        text="John Doe lives at 123 Fake St, phone 555-123-4567",
        name="John Doe",
        address="123 Fake St",
        entity_count=4,
    )
    captured = capsys.readouterr()
    rendered = captured.out + captured.err
    assert "John Doe" not in rendered
    assert "123 Fake St" not in rendered
    assert "555-123-4567" not in rendered
    # Structural, non-PHI data is still logged.
    assert "entity_count" in rendered
    # The redaction marker is present.
    assert REDACTED in rendered
    # Output is valid JSON line(s).
    for line in rendered.strip().splitlines():
        if line.strip():
            json.loads(line)
