"""Age-band mapping (closed-open bands) used for subgroup fairness reporting."""

from __future__ import annotations

import pytest

from medflow_ml.features.encounters import AGE_BANDS, age_band


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (0, "0-17"),
        (17, "0-17"),
        (18, "18-39"),
        (39, "18-39"),
        (40, "40-64"),
        (64, "40-64"),
        (65, "65-74"),
        (74, "65-74"),
        (75, "75+"),
        (89, "75+"),
        (120, "75+"),
    ],
)
def test_age_band_boundaries(age: int, expected: str) -> None:
    assert age_band(age) == expected


def test_age_band_is_left_closed_right_open() -> None:
    # The boundary value belongs to the upper band (lo <= age < hi).
    assert age_band(18) == "18-39"
    assert age_band(40) == "40-64"
    assert age_band(65) == "65-74"
    assert age_band(75) == "75+"


def test_age_band_open_ended_top() -> None:
    assert age_band(200) == "75+"
    assert age_band(10_000) == "75+"


def test_age_band_negative_raises() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        age_band(-1)


def test_age_bands_are_contiguous_and_cover_all_ages() -> None:
    # Each band's high bound equals the next band's low bound (no gaps/overlap).
    for (_, hi, _), (lo_next, _, _) in zip(AGE_BANDS, AGE_BANDS[1:]):
        assert hi == lo_next
    assert AGE_BANDS[0][0] == 0  # starts at 0


def test_every_band_label_is_reachable() -> None:
    labels = {label for _, _, label in AGE_BANDS}
    produced = {age_band(a) for a in range(0, 130)}
    assert labels == produced
