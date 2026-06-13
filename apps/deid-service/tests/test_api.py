"""API tests over the ASGI app with a fake (no-network) audit client."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from medflow_deid.audit import NullAuditClient

from .conftest import synthetic_patient


@pytest.fixture
def client(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_deid_text_removes_phi(
    client: httpx.AsyncClient, fake_audit: NullAuditClient
) -> None:
    async with client:
        resp = await client.post(
            "/v1/deid/text",
            json={"text": "Call MRN: 1234567 at 555-123-4567", "patient_id": "pat-1"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert "1234567" not in body["text"]
    assert "555-123-4567" not in body["text"]
    assert "MRN" in body["entities_removed"]
    assert "PHONE_NUMBER" in body["entities_removed"]
    # entities_removed carries types only — never the values.
    assert "1234567" not in " ".join(body["entities_removed"])
    # An audit event was emitted.
    assert len(fake_audit.events) == 1
    assert fake_audit.events[0].action == "deidentify"
    assert fake_audit.events[0].resource_id == "pat-1"


async def test_deid_text_requires_patient_id(client: httpx.AsyncClient) -> None:
    async with client:
        resp = await client.post("/v1/deid/text", json={"text": "hello"})
    assert resp.status_code == 422


async def test_deid_fhir_patient(
    client: httpx.AsyncClient, fake_audit: NullAuditClient
) -> None:
    async with client:
        resp = await client.post("/v1/deid/fhir", json={"resource": synthetic_patient()})
    assert resp.status_code == 200
    body = resp.json()
    resource = body["resource"]
    assert "name" not in resource
    assert "telecom" not in resource
    assert resource["birthDate"] == "1985"
    assert resource["address"][0] == {"state": "IL", "postalCode": "627", "country": "US"}
    assert "NAME" in body["entities_removed"]
    assert len(fake_audit.events) == 1
    assert fake_audit.events[0].resource_type == "Patient"


async def test_deid_fhir_unsupported_resource_422(client: httpx.AsyncClient) -> None:
    async with client:
        resp = await client.post(
            "/v1/deid/fhir", json={"resource": {"resourceType": "Medication", "id": "m1"}}
        )
    assert resp.status_code == 422


async def test_healthz(client: httpx.AsyncClient) -> None:
    async with client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["service"] == "deid-service"


async def test_metrics_exposed(client: httpx.AsyncClient) -> None:
    async with client:
        await client.post(
            "/v1/deid/text", json={"text": "MRN: 1234567", "patient_id": "p"}
        )
        resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "deid_requests_total" in resp.text
