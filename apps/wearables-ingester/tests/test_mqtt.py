"""MQTT topic/payload parsing tests (pure parse_message logic)."""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from medflow_wearables.mqtt import parse_message

from .conftest import valid_payload


def payload_bytes(**overrides: object) -> bytes:
    data = valid_payload(**overrides)
    data.pop("patient_id", None)
    return json.dumps(data).encode("utf-8")


def test_patient_id_parsed_from_topic() -> None:
    reading = parse_message("vitals/PAT-042", payload_bytes())
    assert reading.patient_id == "PAT-042"


def test_topic_overrides_payload_patient_id() -> None:
    body = json.loads(payload_bytes())
    body["patient_id"] = "SPOOFED"
    reading = parse_message("vitals/PAT-042", json.dumps(body).encode())
    assert reading.patient_id == "PAT-042"


@pytest.mark.parametrize(
    "topic",
    ["vitals", "vitals/", "other/PAT-001", "vitals/PAT-001/extra", ""],
)
def test_malformed_topic_rejected(topic: str) -> None:
    with pytest.raises(ValueError):
        parse_message(topic, payload_bytes())


def test_non_json_payload_rejected() -> None:
    with pytest.raises(ValueError, match="JSON"):
        parse_message("vitals/PAT-001", b"\x00\x01not json")


def test_non_object_json_rejected() -> None:
    with pytest.raises(ValueError, match="object"):
        parse_message("vitals/PAT-001", b"[1, 2, 3]")


def test_out_of_range_vitals_rejected() -> None:
    with pytest.raises(ValidationError):
        parse_message("vitals/PAT-001", payload_bytes(heart_rate=500))


def test_future_ts_rejected() -> None:
    with pytest.raises(ValidationError):
        parse_message("vitals/PAT-001", payload_bytes(ts="2099-01-01T00:00:00+00:00"))
