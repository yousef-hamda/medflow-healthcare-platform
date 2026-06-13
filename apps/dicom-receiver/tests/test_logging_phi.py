"""PHI redaction processor tests."""

from __future__ import annotations

import logging

from medflow_dicom.logging import REDACTED, redact_phi


def test_phi_keys_are_redacted() -> None:
    event = {
        "event": "instance_stored",
        "patient_name": "SYNTHETIC^ONLY",
        "mrn": "1234567",
        "dob": "1980-01-01",
        "phone": "+1 555 000 1234",
        "email": "x@example.com",
        "address": "1 Main St",
        "study_uid": "1.2.3",
    }
    out = redact_phi(logging.getLogger("t"), "info", event)
    for key in ("patient_name", "mrn", "dob", "phone", "email", "address"):
        assert out[key] == REDACTED
    # opaque identifiers survive
    assert out["study_uid"] == "1.2.3"
    assert out["event"] == "instance_stored"


def test_redaction_is_case_insensitive() -> None:
    out = redact_phi(logging.getLogger("t"), "info", {"PatientName": "X"})
    assert out["PatientName"] == REDACTED
