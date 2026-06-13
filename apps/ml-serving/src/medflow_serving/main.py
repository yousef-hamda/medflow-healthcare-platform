"""FastAPI application factory and uvicorn entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from medflow_serving import __version__
from medflow_serving.api.routes import router
from medflow_serving.config import get_settings
from medflow_serving.logging_utils import configure_logging, get_logger
from medflow_serving.persistence.repository import PredictionStore
from medflow_serving.registry.canary import CanaryConfig
from medflow_serving.registry.loader import ModelRegistry

log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    app.state.registry = ModelRegistry(
        tracking_uri=settings.mlflow_tracking_uri,
        stage=settings.model_stage,
        canary=CanaryConfig(
            enabled=settings.canary_enabled,
            canary_version=settings.canary_model_version,
            percent=settings.canary_percent,
        ),
    )
    store = PredictionStore(
        database_url=settings.database_url,
        kafka_brokers=settings.kafka_brokers,
        topic=settings.predictions_topic,
    )
    try:
        await store.start()
        app.state.prediction_store = store
    except Exception as exc:
        log.warning("prediction_store_unavailable", error=str(exc))
        app.state.prediction_store = None
    yield
    if app.state.prediction_store is not None:
        await app.state.prediction_store.stop()


def create_app() -> FastAPI:
    configure_logging()
    app = FastAPI(
        title="MedFlow ML Serving",
        version=__version__,
        description=(
            "Multi-model clinical inference (sepsis EWS, 30-day readmission, "
            "chest X-ray, clinical note NLP). Synthetic data only - no PHI."
        ),
        lifespan=lifespan,
    )
    app.include_router(router)
    return app


app = create_app()


def run() -> None:
    import uvicorn  # noqa: PLC0415

    settings = get_settings()
    uvicorn.run("medflow_serving.main:app", host="0.0.0.0", port=settings.http_port)  # noqa: S104


if __name__ == "__main__":
    run()
