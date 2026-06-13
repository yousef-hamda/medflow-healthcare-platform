"""Encounter-level features: age bands, comorbidity flags, prior admissions.

Pure functions only - the serving side
(``medflow_serving.inference.readmission``) keeps ``COMORBIDITY_PREFIXES``
and ``FEATURE_ORDER`` in sync with this module; change them together.
"""

from __future__ import annotations

from datetime import date, timedelta

# Comorbidity flags derived from ICD-10 prefixes; must stay in sync with
# medflow_serving.inference.readmission.COMORBIDITY_PREFIXES (serving side).
COMORBIDITY_PREFIXES: dict[str, tuple[str, ...]] = {
    "dx_heart_failure": ("I50",),
    "dx_copd": ("J44",),
    "dx_diabetes": ("E10", "E11"),
    "dx_ckd": ("N18",),
    "dx_cancer": ("C",),
    "dx_dementia": ("F01", "F02", "F03", "G30"),
}

FEATURE_ORDER: tuple[str, ...] = (
    "age",
    "sex_female",
    "length_of_stay_days",
    "prior_admissions_90d",
    "prior_admissions_180d",
    "prior_admissions_365d",
    "n_diagnoses",
    "dx_heart_failure",
    "dx_copd",
    "dx_diabetes",
    "dx_ckd",
    "dx_cancer",
    "dx_dementia",
    "discharged_to_facility",
    "has_social_support",
)

# Closed-open [lo, hi) bands; the last band is open-ended.
AGE_BANDS: tuple[tuple[int, int, str], ...] = (
    (0, 18, "0-17"),
    (18, 40, "18-39"),
    (40, 65, "40-64"),
    (65, 75, "65-74"),
    (75, 200, "75+"),
)

PRIOR_ADMISSION_WINDOWS_DAYS: tuple[int, ...] = (90, 180, 365)


def age_band(age: int) -> str:
    """Map an age in years to its reporting band (used for subgroup metrics)."""
    if age < 0:
        raise ValueError(f"age must be non-negative, got {age}")
    for lo, hi, label in AGE_BANDS:
        if lo <= age < hi:
            return label
    return AGE_BANDS[-1][2]


def comorbidity_flags(icd10_codes: list[str]) -> dict[str, float]:
    """0/1 flags per comorbidity group from ICD-10 codes (prefix match)."""
    codes = [c.upper().strip() for c in icd10_codes]
    return {
        name: float(any(code.startswith(prefixes) for code in codes))
        for name, prefixes in COMORBIDITY_PREFIXES.items()
    }


def prior_admission_counts(
    prior_admission_dates: list[date],
    index_admission_date: date,
) -> dict[str, int]:
    """Counts of admissions in the 90/180/365 days **before** the index date.

    Only admissions with ``index - window <= d < index`` count: the index
    admission itself (and anything after it) is excluded, which is the
    anti-leakage property the test suite asserts. The Spark job expresses
    the same logic with window functions; this function is the spec.
    """
    out: dict[str, int] = {}
    for window in PRIOR_ADMISSION_WINDOWS_DAYS:
        start = index_admission_date - timedelta(days=window)
        out[f"prior_admissions_{window}d"] = sum(
            1 for d in prior_admission_dates if start <= d < index_admission_date
        )
    return out


def encounter_feature_row(
    age: int,
    sex: str,
    length_of_stay_days: float,
    prior_admissions_90d: int,
    prior_admissions_180d: int,
    prior_admissions_365d: int,
    diagnoses: list[str],
    discharge_disposition: str = "home",
    has_social_support: bool = True,
) -> list[float]:
    """Deterministic feature vector in :data:`FEATURE_ORDER`.

    Mirrors ``medflow_serving.inference.readmission.encounter_to_row`` so a
    row featurized offline scores identically online.
    """
    flags = comorbidity_flags(diagnoses)
    return [
        float(age),
        1.0 if sex == "female" else 0.0,
        float(length_of_stay_days),
        float(prior_admissions_90d),
        float(prior_admissions_180d),
        float(prior_admissions_365d),
        float(len(diagnoses)),
        flags["dx_heart_failure"],
        flags["dx_copd"],
        flags["dx_diabetes"],
        flags["dx_ckd"],
        flags["dx_cancer"],
        flags["dx_dementia"],
        0.0 if discharge_disposition in ("home", "home_health") else 1.0,
        1.0 if has_social_support else 0.0,
    ]
