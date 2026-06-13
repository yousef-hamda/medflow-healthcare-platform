"""Seed the static MedFlow lineage graph into Marquez via OpenLineage.

The runtime DAGs already emit OpenLineage events for their *runs*, but a fresh
Marquez instance shows nothing until the first pipeline executes. This script
POSTs a set of OpenLineage ``RunEvent``s (a COMPLETE event per logical job)
describing the canonical platform topology so the namespace ``medflow`` is
populated immediately and the end-to-end graph is browsable:

    kafka topics ─▶ bronze Delta ─▶ silver Delta ─▶ gold OMOP CDM
                                                  └▶ ML feature/serving jobs

Each job declares its input and output datasets; Marquez stitches them into the
graph by matching dataset (namespace, name) across jobs. Datasets use the same
``s3://lakehouse/...`` / ``kafka://kafka:9092`` URIs the DAGs reference through
``common/datasets.py`` so the seeded graph and the runtime graph line up.

Standard library only (``urllib``); no OpenLineage client dependency.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Dict, List, Sequence, Tuple

MARQUEZ_URL_DEFAULT = os.environ.get(
    "MEDFLOW_MARQUEZ_URL", "http://marquez:5001"
)
NAMESPACE = os.environ.get("MEDFLOW_LINEAGE_NAMESPACE", "medflow")
PRODUCER = "https://github.com/medflow/data/lineage/seed_lineage.py"
OL_SCHEMA = "https://openlineage.io/spec/1-0-5/OpenLineage.json#/definitions/RunEvent"

KAFKA_NS = os.environ.get("MEDFLOW_KAFKA_NAMESPACE", "kafka://kafka:9092")
LAKEHOUSE_NS = "s3://lakehouse"
SERVING_NS = "http://ml-serving:8094"


def _dataset(namespace: str, name: str) -> Dict[str, str]:
    return {"namespace": namespace, "name": name}


# ─────────────────── static topology (job → inputs, outputs) ───────────────────
# Datasets are (namespace, name) pairs; Marquez links jobs by shared datasets.
JobSpec = Tuple[str, List[Tuple[str, str]], List[Tuple[str, str]]]

JOBS: List[JobSpec] = [
    # ── ingest: kafka → bronze ─────────────────────────────────────────────
    (
        "synthea_to_bronze.fhir_changes_to_bronze",
        [(KAFKA_NS, "fhir.changes")],
        [(LAKEHOUSE_NS, "bronze/fhir_resources")],
    ),
    (
        "hl7_to_bronze.hl7_raw_to_bronze",
        [(KAFKA_NS, "hl7.raw")],
        [(LAKEHOUSE_NS, "bronze/hl7_messages")],
    ),
    (
        "vitals_to_bronze.vitals_raw_to_bronze",
        [(KAFKA_NS, "vitals.raw")],
        [(LAKEHOUSE_NS, "bronze/vitals_raw")],
    ),
    (
        "dicom_manifest_to_bronze.dicom_received_to_bronze",
        [(KAFKA_NS, "dicom.received")],
        [(LAKEHOUSE_NS, "bronze/dicom_metadata")],
    ),
    # ── transform: bronze → silver ─────────────────────────────────────────
    (
        "bronze_to_silver.silver_patients",
        [(LAKEHOUSE_NS, "bronze/fhir_resources")],
        [(LAKEHOUSE_NS, "silver/patients")],
    ),
    (
        "bronze_to_silver.silver_encounters",
        [(LAKEHOUSE_NS, "bronze/fhir_resources")],
        [(LAKEHOUSE_NS, "silver/encounters")],
    ),
    (
        "bronze_to_silver.silver_observations",
        [(LAKEHOUSE_NS, "bronze/fhir_resources")],
        [(LAKEHOUSE_NS, "silver/observations")],
    ),
    (
        "bronze_to_silver.silver_medications",
        [(LAKEHOUSE_NS, "bronze/fhir_resources")],
        [(LAKEHOUSE_NS, "silver/medications")],
    ),
    (
        "bronze_to_silver.silver_imaging_studies",
        [(LAKEHOUSE_NS, "bronze/dicom_metadata")],
        [(LAKEHOUSE_NS, "silver/imaging_studies")],
    ),
    (
        "bronze_to_silver.silver_notes_deid",
        [(LAKEHOUSE_NS, "bronze/fhir_resources")],
        [(LAKEHOUSE_NS, "silver/notes_deid")],
    ),
    # ── transform: silver → gold OMOP (dbt) ────────────────────────────────
    (
        "silver_to_omop.dbt_build_omop",
        [
            (LAKEHOUSE_NS, "silver/patients"),
            (LAKEHOUSE_NS, "silver/encounters"),
            (LAKEHOUSE_NS, "silver/observations"),
            (LAKEHOUSE_NS, "silver/medications"),
            (LAKEHOUSE_NS, "silver/imaging_studies"),
            (LAKEHOUSE_NS, "silver/notes_deid"),
        ],
        [
            (LAKEHOUSE_NS, "gold/person"),
            (LAKEHOUSE_NS, "gold/visit_occurrence"),
            (LAKEHOUSE_NS, "gold/condition_occurrence"),
            (LAKEHOUSE_NS, "gold/drug_exposure"),
            (LAKEHOUSE_NS, "gold/measurement"),
            (LAKEHOUSE_NS, "gold/observation"),
            (LAKEHOUSE_NS, "gold/procedure_occurrence"),
            (LAKEHOUSE_NS, "gold/note"),
            (LAKEHOUSE_NS, "gold/note_nlp"),
        ],
    ),
    # ── ML: gold → features → serving ──────────────────────────────────────
    (
        "feature_backfill.backfill_features",
        [
            (LAKEHOUSE_NS, "gold/person"),
            (LAKEHOUSE_NS, "gold/measurement"),
            (LAKEHOUSE_NS, "gold/visit_occurrence"),
        ],
        [(LAKEHOUSE_NS, "features/sepsis")],
    ),
    (
        "ml_serving.sepsis_model",
        [(LAKEHOUSE_NS, "features/sepsis")],
        [(SERVING_NS, "predict/sepsis")],
    ),
    # ── streaming: vitals → sepsis alerts/aggregates ───────────────────────
    (
        "flink.sepsis_alerting",
        [(KAFKA_NS, "vitals.raw"), (SERVING_NS, "predict/sepsis")],
        [(KAFKA_NS, "alerts"), (KAFKA_NS, "vitals.aggregates")],
    ),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_events(jobs: Sequence[JobSpec]) -> List[Dict]:
    """One START + one COMPLETE RunEvent per job (Marquez needs both)."""
    events: List[Dict] = []
    for job_name, inputs, outputs in jobs:
        run_id = str(uuid.uuid4())
        common = {
            "producer": PRODUCER,
            "schemaURL": OL_SCHEMA,
            "job": {"namespace": NAMESPACE, "name": job_name},
            "run": {"runId": run_id},
            "inputs": [_dataset(ns, name) for ns, name in inputs],
            "outputs": [_dataset(ns, name) for ns, name in outputs],
        }
        events.append({"eventType": "START", "eventTime": _now_iso(), **common})
        events.append({"eventType": "COMPLETE", "eventTime": _now_iso(), **common})
    return events


def post_event(lineage_url: str, event: Dict, timeout: float) -> Tuple[bool, str]:
    body = json.dumps(event).encode("utf-8")
    request = urllib.request.Request(
        lineage_url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 300, str(response.status)
    except urllib.error.HTTPError as exc:  # noqa: PERF203
        return False, f"HTTP {exc.code}: {exc.reason}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--marquez-url",
        default=MARQUEZ_URL_DEFAULT,
        help="Marquez base URL (the OpenLineage endpoint is <url>/api/v1/lineage).",
    )
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the events as JSON instead of POSTing them.",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str]) -> int:
    args = parse_args(argv)
    events = build_events(JOBS)
    lineage_url = f"{args.marquez_url.rstrip('/')}/api/v1/lineage"

    if args.dry_run:
        print(json.dumps(events, indent=2))
        return 0

    sent = 0
    for event in events:
        ok, detail = post_event(lineage_url, event, args.timeout)
        status = "ok" if ok else "FAILED"
        print(
            json.dumps(
                {
                    "event": "lineage_post",
                    "job": event["job"]["name"],
                    "type": event["eventType"],
                    "status": status,
                    "detail": detail,
                }
            )
        )
        sent += int(ok)

    total = len(events)
    print(json.dumps({"event": "seed_done", "sent": sent, "total": total}))
    return 0 if sent == total else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
