"""Canonical MedFlow lakehouse locations and Airflow Datasets.

Every DAG references storage through this module so that:

* physical paths are defined exactly once,
* Airflow data-aware scheduling (``Dataset``) uses stable URIs, and
* the URIs match what ``data/lineage/seed_lineage.py`` registers in Marquez.

Dataset URIs intentionally use the logical ``s3://`` scheme (what Marquez and
OpenLineage see), while Spark jobs receive the Hadoop ``s3a://`` flavour.
"""
from __future__ import annotations

import os

from airflow.datasets import Dataset

# ───────────────────────── physical locations (Spark / s3a) ─────────────────────────
S3A_LAKEHOUSE: str = os.environ.get("MEDFLOW_LAKEHOUSE_URI", "s3a://lakehouse")

BRONZE_FHIR_PATH = f"{S3A_LAKEHOUSE}/bronze/fhir_resources"
BRONZE_HL7_PATH = f"{S3A_LAKEHOUSE}/bronze/hl7_messages"
BRONZE_VITALS_PATH = f"{S3A_LAKEHOUSE}/bronze/vitals_raw"
BRONZE_DICOM_PATH = f"{S3A_LAKEHOUSE}/bronze/dicom_metadata"
BRONZE_NOTES_PATH = f"{S3A_LAKEHOUSE}/bronze/clinical_notes"

SILVER_PATIENTS_PATH = f"{S3A_LAKEHOUSE}/silver/patients"
SILVER_ENCOUNTERS_PATH = f"{S3A_LAKEHOUSE}/silver/encounters"
SILVER_OBSERVATIONS_PATH = f"{S3A_LAKEHOUSE}/silver/observations"
SILVER_MEDICATIONS_PATH = f"{S3A_LAKEHOUSE}/silver/medications"
SILVER_IMAGING_PATH = f"{S3A_LAKEHOUSE}/silver/imaging_studies"
SILVER_NOTES_DEID_PATH = f"{S3A_LAKEHOUSE}/silver/notes_deid"

GOLD_ROOT_PATH = f"{S3A_LAKEHOUSE}/gold"
GOLD_PERSON_PATH = f"{GOLD_ROOT_PATH}/person"
GOLD_MEASUREMENT_PATH = f"{GOLD_ROOT_PATH}/measurement"

SYNTHEA_RAW_BUNDLES_PATH = os.environ.get(
    "MEDFLOW_SYNTHEA_RAW_URI", "s3a://synthea-raw/bundles"
)
IMAGING_MANIFEST_PATH = os.environ.get(
    "MEDFLOW_IMAGING_MANIFEST_URI", "s3a://manifests/imaging.parquet"
)

# ───────────────────────── Airflow Datasets (logical / s3) ─────────────────────────
def _logical(uri: str) -> str:
    return uri.replace("s3a://", "s3://", 1)


DS_BRONZE_FHIR = Dataset(_logical(BRONZE_FHIR_PATH))
DS_BRONZE_HL7 = Dataset(_logical(BRONZE_HL7_PATH))
DS_BRONZE_VITALS = Dataset(_logical(BRONZE_VITALS_PATH))
DS_BRONZE_DICOM = Dataset(_logical(BRONZE_DICOM_PATH))

DS_SILVER_PATIENTS = Dataset(_logical(SILVER_PATIENTS_PATH))
DS_SILVER_ENCOUNTERS = Dataset(_logical(SILVER_ENCOUNTERS_PATH))
DS_SILVER_OBSERVATIONS = Dataset(_logical(SILVER_OBSERVATIONS_PATH))
DS_SILVER_MEDICATIONS = Dataset(_logical(SILVER_MEDICATIONS_PATH))
DS_SILVER_IMAGING = Dataset(_logical(SILVER_IMAGING_PATH))
DS_SILVER_NOTES_DEID = Dataset(_logical(SILVER_NOTES_DEID_PATH))

DS_GOLD_OMOP = Dataset(_logical(GOLD_ROOT_PATH) + "/omop")
DS_FEATURES = Dataset("s3://lakehouse/features/sepsis")
