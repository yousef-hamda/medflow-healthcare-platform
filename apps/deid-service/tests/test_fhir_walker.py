"""FHIR walker: Safe Harbor transformations over synthetic resources."""

from __future__ import annotations

from datetime import date

from medflow_deid.engine.analyzer import TextDeidentifier
from medflow_deid.engine.fhir_walker import deidentify_resource

from .conftest import SECRET, synthetic_patient

ENGINE = TextDeidentifier(use_presidio=False)
REF_DATE = date(2026, 6, 11)


def deid(resource: dict) -> tuple[dict, list[str]]:
    return deidentify_resource(resource, SECRET, reference_date=REF_DATE, text_engine=ENGINE)


def test_name_removed() -> None:
    out, removed = deid(synthetic_patient())
    assert "name" not in out
    assert "NAME" in removed


def test_telecom_removed() -> None:
    out, removed = deid(synthetic_patient())
    assert "telecom" not in out
    assert "CONTACT" in removed


def test_photo_removed() -> None:
    out, _ = deid(synthetic_patient())
    assert "photo" not in out


def test_address_reduced_to_state_and_zip3() -> None:
    out, removed = deid(synthetic_patient())
    addr = out["address"][0]
    assert addr == {"state": "IL", "postalCode": "627", "country": "US"}
    assert "line" not in addr
    assert "city" not in addr
    assert "district" not in addr
    assert "ADDRESS" in removed


def test_address_restricted_zip_to_000() -> None:
    patient = synthetic_patient(
        address=[{"state": "NH", "postalCode": "03601"}]  # 036 is restricted
    )
    out, _ = deid(patient)
    assert out["address"][0]["postalCode"] == "000"


def test_birthdate_reduced_to_year() -> None:
    out, removed = deid(synthetic_patient(birthDate="1985-07-14"))
    assert out["birthDate"] == "1985"
    assert "BIRTHDATE" in removed


def test_age_90_plus_aggregated() -> None:
    # Born 1930 → 96 at reference date → aggregated to floor year.
    out, _ = deid(synthetic_patient(birthDate="1930-01-01"))
    assert out["birthDate"] == "1930"
    # Someone born exactly 90 years before reference date.
    out2, _ = deid(synthetic_patient(birthDate="1936-01-01"))
    assert out2["birthDate"] == "1930"


def test_under_90_keeps_birth_year() -> None:
    out, _ = deid(synthetic_patient(birthDate="2000-03-03"))
    assert out["birthDate"] == "2000"


def test_identifier_pseudonymised() -> None:
    out, removed = deid(synthetic_patient())
    assert out["identifier"][0]["system"] == "urn:medflow:pseudonym"
    assert out["identifier"][0]["value"] != "MRN-12345678"
    assert "IDENTIFIER" in removed


def test_id_pseudonymised_deterministically() -> None:
    out1, _ = deid(synthetic_patient())
    out2, _ = deid(synthetic_patient())
    assert out1["id"] == out2["id"]  # deterministic
    assert out1["id"] != "pat-synthetic-001"


def test_observation_dates_shifted_interval_preserved() -> None:
    obs = {
        "resourceType": "Observation",
        "id": "obs-1",
        "status": "final",
        "subject": {"reference": "Patient/pat-synthetic-001"},
        "effectiveDateTime": "2026-01-10T08:00:00Z",
        "issued": "2026-01-25T08:00:00Z",
    }
    out, _ = deid(obs)
    eff = out["effectiveDateTime"]
    iss = out["issued"]
    assert eff != "2026-01-10T08:00:00Z"  # shifted
    # interval of 15 days preserved
    assert (
        date.fromisoformat(iss[:10]) - date.fromisoformat(eff[:10])
    ).days == 15
