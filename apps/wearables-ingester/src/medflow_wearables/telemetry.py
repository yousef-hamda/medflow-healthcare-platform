"""OpenTelemetry setup (OTLP HTTP exporter, endpoint from environment)."""

from __future__ import annotations

from typing import Any

import structlog

log = structlog.get_logger(__name__)


def setup_telemetry(service_name: str, app: Any | None = None) -> None:
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import SERVICE_NAME, Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        resource = Resource.create({SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
        trace.set_tracer_provider(provider)

        if app is not None:
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

            FastAPIInstrumentor.instrument_app(app)
        log.info("telemetry_initialised", service=service_name)
    except Exception:  # pragma: no cover - defensive
        log.warning("telemetry_init_failed", service=service_name, exc_info=True)
