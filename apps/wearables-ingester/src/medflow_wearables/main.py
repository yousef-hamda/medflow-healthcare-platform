"""App factory + process entrypoint: FastAPI lifespan wires DB, MQTT and Kafka.

Run with ``uvicorn medflow_wearables.main:app`` (the Dockerfile CMD) or
``python -m medflow_wearables.main``.
"""

from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from medflow_wearables import __version__
from medflow_wearables.api import router
from medflow_wearables.config import Settings, get_settings
from medflow_wearables.db import VitalsRepository, create_db_engine, init_db
from medflow_wearables.kafka_producer import VitalsProducer
from medflow_wearables.logging import configure_logging, get_logger
from medflow_wearables.metrics import VITALS_ACCEPTED, VITALS_DUPLICATES
from medflow_wearables.mqtt import run_mqtt_consumer
from medflow_wearables.schemas import VitalsReading
from medflow_wearables.telemetry import setup_telemetry


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)
    log = get_logger(__name__)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings.database_url)
        repo = VitalsRepository(engine, settings.dedup_cache_size)
        try:
            await init_db(engine)
        except Exception:
            log.warning("db_init_failed", exc_info=True)

        producer = VitalsProducer(settings.kafka_brokers, settings.vitals_raw_topic)

        app.state.settings = settings
        app.state.repo = repo
        app.state.producer = producer

        async def on_mqtt_reading(reading: VitalsReading) -> None:
            if await repo.insert(reading):
                VITALS_ACCEPTED.labels(source="mqtt").inc()
                await producer.publish(reading)
            else:
                VITALS_DUPLICATES.labels(source="mqtt").inc()

        mqtt_task = asyncio.create_task(
            run_mqtt_consumer(
                settings.mqtt_broker,
                settings.mqtt_port,
                settings.mqtt_topic_filter,
                on_mqtt_reading,
            )
        )
        log.info("startup_complete", http_port=settings.http_port)
        try:
            yield
        finally:
            mqtt_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await mqtt_task
            await asyncio.to_thread(producer.flush, 5.0)
            await engine.dispose()
            log.info("shutdown_complete")

    app = FastAPI(
        title="MedFlow Wearables Ingester",
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
