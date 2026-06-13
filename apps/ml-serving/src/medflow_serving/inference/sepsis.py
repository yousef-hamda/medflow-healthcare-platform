"""Sepsis early-warning inference (TorchScript LSTM wrapper + cold start)."""

from __future__ import annotations

from dataclasses import dataclass

from medflow_serving.api.schemas import SepsisRequest, ShapItem
from medflow_serving.explain.shap_utils import deep_shap_top5, top_k_attributions
from medflow_serving.fallback.cold_start import sepsis_rule_score
from medflow_serving.inference.featurize import (
    VitalsSample,
    flat_feature_names,
    impute_labs,
    normalize_sequence,
    resample_window,
)
from medflow_serving.registry.loader import LoadedModel


@dataclass(frozen=True)
class SepsisResult:
    risk_score: float
    shap_top5: list[ShapItem]
    model_version: str


class SepsisEngine:
    """Runs the sepsis-ews model (or the documented rule fallback)."""

    def predict(self, request: SepsisRequest, loaded: LoadedModel) -> SepsisResult:
        samples = [
            VitalsSample(
                ts=p.ts,
                heart_rate=p.heart_rate,
                spo2=p.spo2,
                resp_rate=p.resp_rate,
                temp_c=p.temp_c,
                map_mmhg=p.map_mmhg,
            )
            for p in request.vitals_window
        ]
        labs = request.labs.model_dump()

        if loaded.model is None:
            return self._cold_start(samples, labs, loaded.version)

        grid = resample_window(samples)
        sequence = normalize_sequence(grid)
        score = self._score_model(loaded.model, sequence)
        attributions = deep_shap_top5(loaded.model, sequence, flat_feature_names())
        shap_top5 = [
            ShapItem(feature=a.feature, value=a.value, impact=a.impact) for a in attributions
        ]
        return SepsisResult(risk_score=score, shap_top5=shap_top5, model_version=loaded.version)

    @staticmethod
    def _score_model(model: object, sequence: list[list[float]]) -> float:
        import torch  # noqa: PLC0415

        x = torch.tensor([sequence], dtype=torch.float32)
        with torch.no_grad():
            logit = model(x)  # type: ignore[operator]
            return float(torch.sigmoid(logit).reshape(-1)[0])

    @staticmethod
    def _cold_start(
        samples: list[VitalsSample], labs: dict[str, float | None], version: str
    ) -> SepsisResult:
        latest = max(samples, key=lambda s: s.ts)
        score = sepsis_rule_score(latest, labs)
        # Heuristic "attribution": deviation of the latest vitals + labs from
        # population normals, ranked by magnitude. Documented in README.
        names = ["heart_rate", "spo2", "resp_rate", "temp_c", "map_mmhg", "wbc", "lactate", "creatinine"]
        values = [
            latest.heart_rate,
            latest.spo2,
            latest.resp_rate,
            latest.temp_c,
            latest.map_mmhg,
            *impute_labs(labs),
        ]
        from medflow_serving.inference.featurize import POPULATION_NORMALS  # noqa: PLC0415

        impacts = [v - POPULATION_NORMALS[n] for n, v in zip(names, values, strict=True)]
        ranked = top_k_attributions(names, values, impacts)
        shap_top5 = [ShapItem(feature=a.feature, value=a.value, impact=a.impact) for a in ranked]
        return SepsisResult(risk_score=score, shap_top5=shap_top5, model_version=version)
