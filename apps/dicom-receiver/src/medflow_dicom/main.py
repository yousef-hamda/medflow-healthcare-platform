"""Process entrypoint: DICOM SCP (background threads) + FastAPI (uvicorn)."""

from __future__ import annotations

import uvicorn

from medflow_dicom.app import create_app
from medflow_dicom.config import get_settings
from medflow_dicom.events.producer import DicomEventProducer
from medflow_dicom.fhir.imaging_study import FhirClient
from medflow_dicom.logging import configure_logging, get_logger
from medflow_dicom.pipeline.manifest import ManifestWriter
from medflow_dicom.scp.handlers import Dependencies
from medflow_dicom.scp.server import start_server
from medflow_dicom.storage.minio_client import ObjectStore
from medflow_dicom.telemetry import setup_telemetry


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger(__name__)

    store = ObjectStore(
        settings.minio_endpoint, settings.minio_access_key, settings.minio_secret_key
    )
    try:
        store.ensure_bucket(settings.imaging_bucket)
        store.ensure_bucket(settings.manifests_bucket)
    except Exception:
        log.warning("bucket_bootstrap_failed", exc_info=True)

    producer = DicomEventProducer(settings.kafka_brokers, settings.dicom_received_topic)
    deps = Dependencies(
        store=store,
        fhir=FhirClient(settings.fhir_base_url),
        producer=producer,
        manifest=ManifestWriter(store, settings.manifests_bucket, settings.manifest_key),
        imaging_bucket=settings.imaging_bucket,
    )

    scp_server = start_server(settings, deps)

    app = create_app(settings)
    setup_telemetry(settings.service_name, app)

    try:
        uvicorn.run(app, host="0.0.0.0", port=settings.http_port, log_config=None)
    finally:
        scp_server.shutdown()
        producer.flush()
        log.info("shutdown_complete")


if __name__ == "__main__":
    main()
