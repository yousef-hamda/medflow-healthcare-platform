"""pynetdicom Application Entity configuration and server lifecycle."""

from __future__ import annotations

from typing import Any

import structlog
from pynetdicom import AE, evt
from pynetdicom.sop_class import (
    ComputedRadiographyImageStorage,
    CTImageStorage,
    DigitalXRayImageStorageForPresentation,
    DigitalXRayImageStorageForProcessing,
    SecondaryCaptureImageStorage,
    Verification,
)
from pydicom.uid import ExplicitVRLittleEndian, ImplicitVRLittleEndian

from medflow_dicom.config import Settings
from medflow_dicom.scp.handlers import Dependencies, handle_echo, handle_store

log = structlog.get_logger(__name__)

STORAGE_SOP_CLASSES = (
    CTImageStorage,
    ComputedRadiographyImageStorage,
    DigitalXRayImageStorageForPresentation,
    DigitalXRayImageStorageForProcessing,
    SecondaryCaptureImageStorage,
)
TRANSFER_SYNTAXES = [ExplicitVRLittleEndian, ImplicitVRLittleEndian]


def create_ae(settings: Settings) -> AE:
    ae = AE(ae_title=settings.dicom_ae_title)
    ae.add_supported_context(Verification)
    for sop_class in STORAGE_SOP_CLASSES:
        ae.add_supported_context(sop_class, TRANSFER_SYNTAXES)
    ae.maximum_pdu_size = 0  # unlimited
    return ae


def start_server(settings: Settings, deps: Dependencies) -> Any:
    """Start the DICOM SCP in pynetdicom's own threads; returns the server."""
    ae = create_ae(settings)
    handlers = [
        (evt.EVT_C_STORE, handle_store, [deps]),
        (evt.EVT_C_ECHO, handle_echo),
    ]
    server = ae.start_server(
        ("0.0.0.0", settings.dicom_port),
        block=False,
        evt_handlers=handlers,
    )
    log.info(
        "dicom_scp_started",
        ae_title=settings.dicom_ae_title,
        port=settings.dicom_port,
        sop_classes=len(STORAGE_SOP_CLASSES),
    )
    return server
