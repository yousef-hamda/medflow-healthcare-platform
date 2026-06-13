"""30-day readmission inference (XGBoost Booster + cold start)."""

from __future__ import annotations

from dataclasses import dataclass

from medflow_serving.api.schemas import Encounter, ReadmissionRequest, ShapItem
from medflow_serving.explain.shap_utils import top_k_attributions, tree_shap_top5
from medflow_serving.fallback.cold_start import readmission_rule_score
from medflow_serving.registry.loader import LoadedModel

# Comorbidity flags derived from ICD-10 prefixes; must stay in sync with
# medflow_ml.features.encounters (training side).
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


def encounter_to_row(encounter: Encounter) -> list[float]:
    """Deterministic feature vector in :data:`FEATURE_ORDER`. Pure function."""
    codes = [c.upper().strip() for c in encounter.diagnoses]
    flags = {
        name: float(any(code.startswith(prefixes) for code in codes))
        for name, prefixes in COMORBIDITY_PREFIXES.items()
    }
    return [
        float(encounter.age),
        1.0 if encounter.sex == "female" else 0.0,
        float(encounter.length_of_stay_days),
        float(encounter.prior_admissions_90d),
        float(encounter.prior_admissions_180d),
        float(encounter.prior_admissions_365d),
        float(len(codes)),
        flags["dx_heart_failure"],
        flags["dx_copd"],
        flags["dx_diabetes"],
        flags["dx_ckd"],
        flags["dx_cancer"],
        flags["dx_dementia"],
        0.0 if encounter.discharge_disposition in ("home", "home_health") else 1.0,
        1.0 if encounter.has_social_support else 0.0,
    ]


@dataclass(frozen=True)
class ReadmissionResult:
    probability: float
    shap_top5: list[ShapItem]
    model_version: str


class ReadmissionEngine:
    def predict(self, request: ReadmissionRequest, loaded: LoadedModel) -> ReadmissionResult:
        row = encounter_to_row(request.encounter)
        names = list(FEATURE_ORDER)

        if loaded.model is None:
            probability = readmission_rule_score(
                length_of_stay_days=request.encounter.length_of_stay_days,
                prior_admissions_365d=request.encounter.prior_admissions_365d,
                n_diagnoses=len(request.encounter.diagnoses),
                discharge_disposition=request.encounter.discharge_disposition,
                has_social_support=request.encounter.has_social_support,
                age=request.encounter.age,
            )
            # Heuristic attribution for cold start: raw feature magnitudes.
            ranked = top_k_attributions(names, row, row)
            shap_top5 = [
                ShapItem(feature=a.feature, value=a.value, impact=a.impact) for a in ranked
            ]
            return ReadmissionResult(
                probability=probability, shap_top5=shap_top5, model_version=loaded.version
            )

        probability = self._score_booster(loaded.model, row, names)
        attributions = tree_shap_top5(loaded.model, names, row)
        shap_top5 = [
            ShapItem(feature=a.feature, value=a.value, impact=a.impact) for a in attributions
        ]
        return ReadmissionResult(
            probability=probability, shap_top5=shap_top5, model_version=loaded.version
        )

    @staticmethod
    def _score_booster(booster: object, row: list[float], names: list[str]) -> float:
        import numpy as np  # noqa: PLC0415
        import xgboost as xgb  # noqa: PLC0415

        dmatrix = xgb.DMatrix(np.asarray([row], dtype=np.float32), feature_names=names)
        return float(booster.predict(dmatrix)[0])  # type: ignore[attr-defined]
