"""Text analyzer: MRN + phone regex detection in regex-only mode.

All inputs are SYNTHETIC.
"""

from __future__ import annotations

from medflow_deid.engine.analyzer import TextDeidentifier

ENGINE = TextDeidentifier(use_presidio=False)


def types(text: str) -> list[str]:
    _, removed = ENGINE.scrub(text)
    return removed


def test_mrn_detected_and_removed() -> None:
    cleaned, removed = ENGINE.scrub("Patient MRN: 1234567 admitted today.")
    assert "MRN" in removed
    assert "1234567" not in cleaned
    assert "[MRN]" in cleaned


def test_us_phone_detected() -> None:
    cleaned, removed = ENGINE.scrub("Call (555) 123-4567 for results.")
    assert "PHONE_NUMBER" in removed
    assert "123-4567" not in cleaned


def test_us_phone_dashed() -> None:
    assert "PHONE_NUMBER" in types("Reach me at 555-123-4567.")


def test_israeli_phone_detected() -> None:
    assert "PHONE_NUMBER" in types("Mobile +972-50-123-4567 is on file.")


def test_email_detected() -> None:
    cleaned, removed = ENGINE.scrub("Email synthetic@example.com to confirm.")
    assert "EMAIL_ADDRESS" in removed
    assert "synthetic@example.com" not in cleaned


def test_ssn_detected() -> None:
    assert "US_SSN" in types("SSN 123-45-6789 on record.")


def test_fhir_reference_detected() -> None:
    assert "FHIR_REFERENCE" in types("See Patient/abc-123 for history.")


def test_clean_text_untouched() -> None:
    text = "The patient reports feeling much better after treatment."
    cleaned, removed = ENGINE.scrub(text)
    assert cleaned == text
    assert removed == []


def test_entities_removed_are_types_only_no_values() -> None:
    _, removed = ENGINE.scrub("MRN: 1234567 phone 555-123-4567")
    # Returned list must contain only type labels, never the original values.
    assert "1234567" not in " ".join(removed)
    assert "555-123-4567" not in " ".join(removed)
