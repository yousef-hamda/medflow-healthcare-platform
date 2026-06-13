"""API tests over the ASGI app with fake repository and Kafka producer."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from .conftest import FakeProducer, FakeRepo, valid_payload


@pytest.fixture
def client(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://test")


async def test_post_vitals_accepted(
    client: httpx.AsyncClient, fake_repo: FakeRepo, fake_producer: FakeProducer
) -> None:
    async with client:
        resp = await client.post("/v1/vitals", json=valid_payload())
    assert resp.status_code == 202
    assert resp.json() == {"status": "accepted"}
    assert len(fake_repo.readings) == 1
    assert len(fake_producer.published) == 1


async def test_post_duplicate_not_republished(
    client: httpx.AsyncClient, fake_producer: FakeProducer
) -> None:
    async with client:
        first = await client.post("/v1/vitals", json=valid_payload())
        second = await client.post("/v1/vitals", json=valid_payload())
    assert first.json() == {"status": "accepted"}
    assert second.status_code == 202
    assert second.json() == {"status": "duplicate"}
    assert len(fake_producer.published) == 1


async def test_post_invalid_vitals_422(
    client: httpx.AsyncClient, fake_producer: FakeProducer
) -> None:
    async with client:
        resp = await client.post("/v1/vitals", json=valid_payload(spo2=120))
    assert resp.status_code == 422
    assert fake_producer.published == []


async def test_get_vitals_filters_by_since(client: httpx.AsyncClient) -> None:
    async with client:
        for minute in (0, 10, 20):
            await client.post(
                "/v1/vitals", json=valid_payload(ts=f"2026-06-01T12:{minute:02d}:00+00:00")
            )
        resp = await client.get(
            "/v1/vitals/PAT-001", params={"since": "2026-06-01T12:10:00+00:00"}
        )
    body = resp.json()
    assert resp.status_code == 200
    assert [row["ts"] for row in body] == [
        "2026-06-01T12:10:00Z",
        "2026-06-01T12:20:00Z",
    ]


async def test_get_vitals_unknown_patient_empty(client: httpx.AsyncClient) -> None:
    async with client:
        resp = await client.get("/v1/vitals/NOBODY")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_healthz(client: httpx.AsyncClient) -> None:
    async with client:
        resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    assert resp.json()["service"] == "wearables-ingester"


async def test_metrics_exposed(client: httpx.AsyncClient) -> None:
    async with client:
        resp = await client.get("/metrics")
    assert resp.status_code == 200
    assert "vitals_accepted_total" in resp.text
