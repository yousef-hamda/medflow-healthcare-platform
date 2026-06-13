"""SHAP attribution helpers for the serving path.

* XGBoost readmission model -> ``shap.TreeExplainer`` (exact, fast).
* LSTM sepsis model -> ``shap.DeepExplainer``; if DeepExplainer cannot
  handle the TorchScript graph we fall back to a permutation explainer over
  the flattened sequence, and finally to a magnitude heuristic so the API
  always returns *some* ranked attribution.

The pure ranking logic (:func:`top_k_attributions`) is dependency-free and
unit-tested separately.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from medflow_serving.logging_utils import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class ShapAttribution:
    feature: str
    value: float
    impact: float


def top_k_attributions(
    feature_names: list[str],
    values: list[float],
    impacts: list[float],
    k: int = 5,
) -> list[ShapAttribution]:
    """Rank features by |impact| descending and return the top ``k``."""
    if not (len(feature_names) == len(values) == len(impacts)):
        raise ValueError("feature_names, values and impacts must be the same length")
    ranked = sorted(
        zip(feature_names, values, impacts, strict=True), key=lambda t: abs(t[2]), reverse=True
    )
    return [ShapAttribution(feature=f, value=v, impact=i) for f, v, i in ranked[:k]]


def tree_shap_top5(
    booster: Any, feature_names: list[str], row: list[float]
) -> list[ShapAttribution]:
    """TreeExplainer attributions for one XGBoost row."""
    import numpy as np  # noqa: PLC0415
    import shap  # noqa: PLC0415

    explainer = shap.TreeExplainer(booster)
    x = np.asarray([row], dtype=np.float32)
    shap_values = np.asarray(explainer.shap_values(x))[0]
    return top_k_attributions(feature_names, row, [float(v) for v in shap_values])


def deep_shap_top5(
    model: Any,
    sequence: list[list[float]],
    feature_names: list[str],
    background: Any | None = None,
) -> list[ShapAttribution]:
    """DeepExplainer over the LSTM input; permutation fallback; never raises."""
    import numpy as np  # noqa: PLC0415
    import torch  # noqa: PLC0415

    x = torch.tensor([sequence], dtype=torch.float32)
    flat_values = [v for row in sequence for v in row]

    try:
        import shap  # noqa: PLC0415

        bg = background if background is not None else torch.zeros_like(x)
        explainer = shap.DeepExplainer(model, bg)
        shap_values = np.asarray(explainer.shap_values(x)).reshape(-1)
        return top_k_attributions(feature_names, flat_values, [float(v) for v in shap_values])
    except Exception as exc:
        log.warning("deep_explainer_failed_using_permutation", error=str(exc))

    try:
        return _permutation_top5(model, x, flat_values, feature_names)
    except Exception as exc:
        log.warning("permutation_explainer_failed_using_magnitude", error=str(exc))
        return top_k_attributions(feature_names, flat_values, flat_values)


def _permutation_top5(
    model: Any, x: Any, flat_values: list[float], feature_names: list[str]
) -> list[ShapAttribution]:
    """Leave-one-out occlusion over flattened [steps x features] positions."""
    import torch  # noqa: PLC0415

    with torch.no_grad():
        base = float(torch.sigmoid(model(x)).reshape(-1)[0])
        impacts: list[float] = []
        steps, n_features = int(x.shape[1]), int(x.shape[2])
        for step in range(steps):
            for feat in range(n_features):
                occluded = x.clone()
                occluded[0, step, feat] = 0.0
                score = float(torch.sigmoid(model(occluded)).reshape(-1)[0])
                impacts.append(base - score)
    return top_k_attributions(feature_names, flat_values, impacts)
