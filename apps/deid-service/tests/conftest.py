"""Shared fixtures: synthetic FHIR resources, fake audit client, wired test app.

All data here is SYNTHETIC. No real PHI.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI

from medflow_deid.api import router
from medflow_deid.audit import NullAuditClient
from medflow_deid.config import Settings
from medflow_deid.engine.analyzer import TextDeidentifier

SECRET = "test-secret"


def synthetic_patient(**overrides: Any) -> dict[str, Any]:
    """A synthetic FHIR Patient with every PHI-bearing field populated."""
    patient: dict[str, Any] = {
        "resourceType": "Patient",
        "id": "pat-synthetic-001",
        "identifier": [{"system": "urn:mrn", "value": "MRN-12345678"}],
        "name": [{"use": "official", "family": "Testpatient", "given": ["Synthetic", "A"]}],
        "telecom": [
            {"system": "phone", "value": "555-123-4567"},
            {"system": "email", "value": "synthetic@example.com"},
        ],
        "gender": "female",
        "birthDate": "1985-07-14",
        "address": [
            {
                "use": "home",
                "line": ["123 Fake Street"],
                "city": "Springfield",
                "district": "Sangamon",
                "state": "IL",
                "postalCode": "62704",
                "country": "US",
            }
        ],
        "photo": [{"contentType": "image/png", "data": "Zm9v"}],
    }
    patient.update(overrides)
    return patient


@pytest.fixture
def text_engine() -> TextDeidentifier:
    """Regex-only engine (deterministic, no Presidio/spaCy needed)."""
    return TextDeidentifier(use_presidio=False)


@pytest.fixture
def fake_audit() -> NullAuditClient:
    return NullAuditClient()


@pytest.fixture
def settings() -> Settings:
    return Settings(date_shift_secret=SECRET)


@pytest.fixture
def app(
    text_engine: TextDeidentifier, fake_audit: NullAuditClient, settings: Settings
) -> FastAPI:
    """Router under test with fakes on app.state (no lifespan side effects)."""
    test_app = FastAPI()
    test_app.include_router(router)
    test_app.state.settings = settings
    test_app.state.text_engine = text_engine
    test_app.state.audit = fake_audit
    return test_app
