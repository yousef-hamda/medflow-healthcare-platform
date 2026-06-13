"""App factory + process entrypoint: FastAPI lifespan wires the text engine,
audit worker and telemetry.

Run with ``uvicorn medflow_deid.main:app`` (the Dockerfile CMD) or
``python -m medflow_deid.main``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from medflow_deid import __version__
from medflow_deid.api import router
from medflow_deid.audit import AuditClient
from medflow_deid.config import Settings, get_settings
from medflow_deid.engine.analyzer import get_text_engine
from medflow_deid.logging import configure_logging, get_logger
from medflow_deid.telemetry import setup_telemetry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    log = get_logger(__name__)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        audit = AuditClient.from_settings(settings)
        await audit.start()

        app.state.settings = settings
        app.state.text_engine = get_text_engine()
        app.state.audit = audit

        log.info(
            "startup_complete",
            http_port=settings.http_port,
            presidio_active=app.state.text_engine.presidio_active,
        )
        try:
            yield
        finally:
            await audit.stop()
            log.info("shutdown_complete")

    app = FastAPI(
        title="MedFlow De-Identification Service",
        version=__version__,
        docs_url=None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.include_router(router)
    setup_telemetry(settings.service_name, app)
    return app


app = create_app()


def main() -> None:
    settings = get_settings()
    uvicorn.run(app, host="0.0.0.0", port=settings.http_port, log_config=None)


if __name__ == "__main__":
    main()
