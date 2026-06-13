# MedFlow — Lineage Seeding

`seed_lineage.py` populates a fresh **Marquez** instance with the canonical
MedFlow data-platform topology so the lineage graph is browsable before any DAG
has run. It POSTs OpenLineage `RunEvent`s (one `START` + one `COMPLETE` per
logical job) to `http://marquez:5001/api/v1/lineage`, namespace `medflow`, using
only the Python standard library (`urllib`) — no OpenLineage client dependency.

## The seeded graph

```
kafka topics                bronze (Delta)            silver (Delta)            gold OMOP CDM (Delta)
  fhir.changes  ─────────▶  bronze/fhir_resources ─┬▶ silver/patients     ─┐
  hl7.raw       ─────────▶  bronze/hl7_messages    │  silver/encounters    │
  vitals.raw    ─────────▶  bronze/vitals_raw      │  silver/observations  ├▶ dbt ─▶ person,
  dicom.received─────────▶  bronze/dicom_metadata ─┤  silver/medications   │        visit_occurrence,
                                                   │  silver/imaging_studies│        condition_occurrence,
                                                   └▶ silver/notes_deid    ─┘        drug_exposure, measurement,
                                                                                     observation,
                                                                                     procedure_occurrence,
                                                                                     note, note_nlp
gold ─▶ features/sepsis ─▶ ml-serving predict/sepsis
vitals.raw + predict/sepsis ─▶ flink sepsis_alerting ─▶ alerts, vitals.aggregates
```

Marquez stitches jobs into a single DAG by matching `(namespace, name)` on the
input/output **datasets**, which use the same URIs the Airflow DAGs reference via
`common/datasets.py` (`s3://lakehouse/...`, `kafka://kafka:9092`). So the seeded
static graph and the graph the running DAGs emit at runtime line up exactly.

## Usage

```bash
# Seed against the local Marquez (default http://marquez:5001):
python seed_lineage.py

# Inspect the events without sending them:
python seed_lineage.py --dry-run

# Override target / namespace via env or flags:
MEDFLOW_MARQUEZ_URL=http://localhost:5001 \
MEDFLOW_LINEAGE_NAMESPACE=medflow \
python seed_lineage.py
```

Exit code is non-zero if any event failed to POST, so it can be wired into a
bootstrap `Makefile` target or an init container. It is idempotent: re-running
re-asserts the same job/dataset definitions (new run ids each time) without
duplicating the graph topology.
