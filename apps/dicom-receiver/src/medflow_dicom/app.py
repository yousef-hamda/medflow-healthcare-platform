"""FastAPI app exposing /healthz and /metrics on HTTP_PORT."""

from __future__ import annotations

from fastapi import FastAPI, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from medflow_dicom import __version__
from medflow_dicom.config import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="MedFlow DICOM Receiver",
        version=__version__,
        docs_url=None,
        redoc_url=None,
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {
            "status": "ok",
            "service": settings.service_name,
            "version": __version__,
        }

    @app.get("/metrics")
    def metrics_endpoint() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app
