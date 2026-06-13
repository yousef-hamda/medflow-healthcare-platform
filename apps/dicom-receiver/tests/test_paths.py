"""Path sanitisation tests: object keys must be traversal-proof."""

from __future__ import annotations

import pytest

from medflow_dicom.storage.paths import (
    FALLBACK_SEGMENT,
    instance_key,
    preview_key,
    sanitize_segment,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("PAT-001", "PAT-001"),
        ("1.2.840.113619.2.55", "1.2.840.113619.2.55"),
        ("a b/c", "a_b_c"),
        ("..", FALLBACK_SEGMENT),
        ("../../etc/passwd", "etc_passwd"),
        ("", FALLBACK_SEGMENT),
        ("   ", FALLBACK_SEGMENT),
        ("___", FALLBACK_SEGMENT),
        (".hidden", "hidden"),
        ("trailing.", "trailing"),
        ("uid\x00null", "uid_null"),
        ("über/patient", "_ber_patient"),
    ],
)
def test_sanitize_segment(raw: str, expected: str) -> None:
    assert sanitize_segment(raw) == expected


def test_sanitize_caps_length() -> None:
    assert len(sanitize_segment("x" * 500)) <= 128


def test_traversal_never_survives() -> None:
    for hostile in ("..", "../..", "a/../b", "..\\..", "%2e%2e%2f"):
        cleaned = sanitize_segment(hostile)
        assert "/" not in cleaned
        assert "\\" not in cleaned
        assert ".." not in cleaned.split("_")  # no standalone dot-dot segment


def test_instance_key_shape() -> None:
    key = instance_key("PAT 1", "1.2.3", "4.5.6")
    assert key == "PAT_1/1.2.3/4.5.6.dcm"


def test_preview_key_shape() -> None:
    key = preview_key("PAT-1", "1.2.3", "4.5.6")
    assert key == "PAT-1/1.2.3/4.5.6.preview.png"
