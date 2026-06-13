"""MLflow model-registry loader with stable/canary tracks and cold-start fallback.

Models are resolved from the MLflow registry by ``name`` + ``stage`` (stable
track) or ``name`` + explicit ``version`` (canary track). When the registry
has no model yet (fresh `make dev` before any training job ran), the loader
returns ``None`` and callers fall back to the documented rule-based
cold-start scorers in :mod:`medflow_serving.fallback.cold_start`.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

from medflow_serving.logging_utils import get_logger
from medflow_serving.registry.canary import CanaryConfig, ModelTrack, resolve_track

log = get_logger(__name__)

COLD_START_VERSION = "cold-start-rules-v1"


@dataclass(frozen=True)
class LoadedModel:
    """A model resolved from the registry (or absent => cold start)."""

    name: str
    version: str
    track: ModelTrack
    flavor: str  # "pytorch" | "xgboost" | "pyfunc" | "cold-start"
    model: Any | None  # None => rule-based fallback


class ModelRegistry:
    """Caches one stable + optional canary model per registered name.

    Thread-safe lazy loading; a failed registry lookup is cached as a
    cold-start sentinel and retried on explicit :meth:`refresh`.
    """

    def __init__(
        self,
        tracking_uri: str,
        stage: str = "Production",
        canary: CanaryConfig | None = None,
    ) -> None:
        self._tracking_uri = tracking_uri
        self._stage = stage
        self._canary = canary or CanaryConfig(enabled=False, canary_version=None, percent=0)
        self._cache: dict[tuple[str, ModelTrack], LoadedModel] = {}
        self._lock = threading.Lock()

    # ------------------------------------------------------------------ load
    def model_for(self, name: str, patient_id: str, flavor: str) -> LoadedModel:
        """Resolve the model that should serve this patient (canary-aware)."""
        track = resolve_track(patient_id, self._canary)
        key = (name, track)
        with self._lock:
            cached = self._cache.get(key)
            if cached is not None:
                return cached
            loaded = self._load(name, track, flavor)
            self._cache[key] = loaded
            return loaded

    def refresh(self) -> None:
        """Drop the cache so the next request re-resolves from MLflow."""
        with self._lock:
            self._cache.clear()

    def loaded_versions(self) -> dict[str, str]:
        with self._lock:
            return {f"{name}:{track.value}": m.version for (name, track), m in self._cache.items()}

    # -------------------------------------------------------------- internals
    def _load(self, name: str, track: ModelTrack, flavor: str) -> LoadedModel:
        uri = self._model_uri(name, track)
        try:
            model, version = self._fetch(uri, name, track, flavor)
        except Exception as exc:  # registry empty / MLflow down => cold start
            log.warning(
                "model_load_failed_falling_back_to_cold_start",
                model_name=name,
                track=track.value,
                error=str(exc),
            )
            return LoadedModel(
                name=name, version=COLD_START_VERSION, track=track, flavor="cold-start", model=None
            )
        log.info("model_loaded", model_name=name, version=version, track=track.value, flavor=flavor)
        return LoadedModel(name=name, version=version, track=track, flavor=flavor, model=model)

    def _model_uri(self, name: str, track: ModelTrack) -> str:
        if track is ModelTrack.CANARY and self._canary.canary_version:
            return f"models:/{name}/{self._canary.canary_version}"
        return f"models:/{name}/{self._stage}"

    def _fetch(self, uri: str, name: str, track: ModelTrack, flavor: str) -> tuple[Any, str]:
        # Imported lazily so unit tests of routing logic never need MLflow.
        import mlflow  # noqa: PLC0415
        from mlflow.tracking import MlflowClient  # noqa: PLC0415

        mlflow.set_tracking_uri(self._tracking_uri)
        if flavor == "pytorch":
            model = mlflow.pytorch.load_model(uri)
        elif flavor == "xgboost":
            model = mlflow.xgboost.load_model(uri)
        else:
            model = mlflow.pyfunc.load_model(uri)

        client = MlflowClient(tracking_uri=self._tracking_uri)
        if track is ModelTrack.CANARY and self._canary.canary_version:
            version = self._canary.canary_version
        else:
            latest = client.get_latest_versions(name, stages=[self._stage])
            version = latest[0].version if latest else "unknown"
        return model, str(version)
