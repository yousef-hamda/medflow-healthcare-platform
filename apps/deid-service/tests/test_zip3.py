"""ZIP3 generalisation: truncation + restricted-prefix handling."""

from __future__ import annotations

import pytest

from medflow_deid.engine.zip3 import RESTRICTED_ZIP3, zip3

RESTRICTED = [
    "036",
    "059",
    "063",
    "102",
    "203",
    "556",
    "692",
    "790",
    "821",
    "823",
    "830",
    "831",
    "878",
    "879",
    "884",
    "890",
    "893",
]


def test_basic_truncation() -> None:
    assert zip3("62704") == "627"
    assert zip3("90210") == "902"


def test_zip_plus_four() -> None:
    assert zip3("62704-1234") == "627"
    assert zip3("90210-0000") == "902"


def test_restricted_list_matches_spec() -> None:
    assert RESTRICTED_ZIP3 == set(RESTRICTED)


@pytest.mark.parametrize("prefix", RESTRICTED)
def test_restricted_prefixes_map_to_000(prefix: str) -> None:
    assert zip3(prefix + "12") == "000"


def test_unparseable_returns_000() -> None:
    assert zip3("") == "000"
    assert zip3("abc") == "000"
    assert zip3("12") == "000"  # fewer than 5 digits
    assert zip3(None) == "000"  # type: ignore[arg-type]


def test_non_restricted_kept() -> None:
    assert zip3("12345") == "123"
