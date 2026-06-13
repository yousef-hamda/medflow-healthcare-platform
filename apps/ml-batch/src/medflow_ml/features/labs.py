"""Lab abnormality flags against adult reference ranges - pure functions.

Reference ranges are textbook adult values for synthetic data only; they
are NOT a clinical decision aid. Each lab gets a ``*_low`` / ``*_high``
flag plus an ``*_abnormal`` OR of the two.
"""

from __future__ import annotations

# name -> (low_limit, high_limit) inclusive normal range.
LAB_REFERENCE_RANGES: dict[str, tuple[float, float]] = {
    "wbc": (4.0, 11.0),  # 10^3/uL
    "lactate": (0.5, 2.0),  # mmol/L
    "creatinine": (0.6, 1.3),  # mg/dL
    "sodium": (135.0, 145.0),  # mmol/L
    "potassium": (3.5, 5.1),  # mmol/L
    "hemoglobin": (12.0, 17.5),  # g/dL
    "platelets": (150.0, 400.0),  # 10^3/uL
    "bilirubin": (0.1, 1.2),  # mg/dL
}


def lab_abnormality_flags(labs: dict[str, float | None]) -> dict[str, int]:
    """Return ``{lab}_low`` / ``{lab}_high`` / ``{lab}_abnormal`` 0-1 flags.

    Labs not present (or ``None``) contribute zeroed flags so the output
    schema is fixed regardless of which labs were drawn for a patient.
    """
    flags: dict[str, int] = {}
    for name, (low, high) in LAB_REFERENCE_RANGES.items():
        value = labs.get(name)
        is_low = int(value is not None and value < low)
        is_high = int(value is not None and value > high)
        flags[f"{name}_low"] = is_low
        flags[f"{name}_high"] = is_high
        flags[f"{name}_abnormal"] = int(bool(is_low or is_high))
    return flags


def lab_flag_field_names() -> list[str]:
    """Stable ordered list of all emitted flag column names (for Feast schema)."""
    names: list[str] = []
    for name in LAB_REFERENCE_RANGES:
        names.extend([f"{name}_low", f"{name}_high", f"{name}_abnormal"])
    return names
