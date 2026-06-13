# MedFlow Data Lake — Medallion Design and OMOP Gold

> Companion to [architecture.md](architecture.md) §2.5 and the HL7→OMOP narrative in §3.2.
> Storage: Delta Lake on MinIO `s3://lakehouse/{bronze,silver,gold}`; compute: Spark 3.5;
> orchestration: Airflow DAGs in `data/airflow/dags/`; transformation to OMOP: dbt-spark;
> quality gates: Great Expectations (`data/great_expectations/`); lineage: OpenLineage → Marquez
> (:3003 UI); query: Trino `delta` catalog → Superset. Decision records:
> [ADR-0001 (Delta)](adr/0001-lakehouse-on-delta.md), [ADR-0002 (OMOP as gold)](adr/0002-omop-as-gold.md).

## 1. Why medallion (and what each layer promises)

The three layers are **contracts**, not folders:

- **Bronze — "what arrived."** Append-only, schema-on-read-ish landings of source payloads with
  ingest metadata. Promise: replayability. If every downstream table burned down, bronze plus
  the DAGs rebuild them; if a mapper had a bug, bronze still has the truth. Bronze is the
  lakehouse twin of the interop layer's raw-before-map rule
  ([architecture.md](architecture.md#22-interop-layer)).
- **Silver — "what it means."** Deduplicated, typed, conformed, identity-resolved clinical
  events; **de-identified** (HMAC patient pseudonym, per-patient date shift) because silver is
  the first layer analysts can touch ([compliance.md](compliance.md#1-phi-inventory--164308a1iia-input)).
  Promise: one row = one real event, types are trustworthy, GE has signed off.
- **Gold — "what the question needs."** OMOP CDM v5.4 built by dbt-spark. Promise: standard
  vocabulary, referential integrity, fit for cohort queries and BI without bespoke joins.

The alternative — mapping sources straight to OMOP — couples ingestion bugs to analytics
(no replay layer) and forces every new source to solve identity + vocabulary + quality at once.
The layers let each DAG do one job and let GE gate each promotion.

## 2. Table schemas and partitioning

### 2.1 Bronze

All bronze tables share ingest metadata columns: `_ingest_ts`, `_ingest_date` (partition),
`_source` (topic/bucket), `_offset`/`_object_key` (provenance pointer).

| Table | Source | Key payload columns | Partitioning |
|---|---|---|---|
| `bronze.fhir_changes` | `fhir.changes` topic | `resource_type`, `resource_id`, `version_id`, `operation`, `resource_json` (string) | `_ingest_date`, `resource_type` |
| `bronze.synthea_bundles` | MinIO `synthea-raw` | `bundle_id`, `bundle_json` | `_ingest_date` |
| `bronze.hl7_messages` | `hl7.raw` topic | `control_id` (MSH-10), `message_type`, `raw_message`, `received_ts` | `_ingest_date` |
| `bronze.vitals` | `vitals.raw` topic | `patient_id`, `device_id`, `metric`, `value`, `unit`, `event_ts` | `_ingest_date` |
| `bronze.dicom_manifests` | `dicom.received` topic | `study_uid`, `series_uid`, `sop_uid`, `modality`, `object_key`, `study_date` | `_ingest_date` |

Kafka-sourced DAGs do **exactly-once via offset bookmarking in Delta**: the consumed
(topic, partition, offset) high-water marks commit in the *same Delta transaction* as the data,
so a retried task run re-reads from the bookmark and the MERGE no-ops on already-landed rows.

### 2.2 Silver

De-identified: `person_key` is the HMAC pseudonym; all timestamps carry the per-patient shift
([compliance.md](compliance.md#5-de-identification--164514b)).

| Table | Grain | Key columns | Partitioning |
|---|---|---|---|
| `silver.patients` | one row per resolved patient | `person_key`, `birth_year`, `gender`, `zip3`, `age_90_plus` | none (small) |
| `silver.encounters` | one per encounter | `encounter_key`, `person_key`, `class`, `start_ts`, `end_ts`, `discharge_disposition` | `start_date` (monthly) |
| `silver.observations` | one per clinical observation | `person_key`, `encounter_key`, `loinc_code`, `value_num`, `value_text`, `unit`, `effective_ts` | `effective_date` (monthly), z-ordered by `person_key` |
| `silver.vitals` | one per device reading (deduped) | `person_key`, `metric`, `value`, `unit`, `event_ts`, `device_key` | `event_date` (daily — the big one) |
| `silver.conditions` / `silver.medications` / `silver.procedures` | one per event | `person_key`, source code + system, onset/start ts | monthly |
| `silver.imaging_studies` | one per study | `study_key`, `person_key`, `modality`, `series_count`, `instance_count` | monthly |
| `silver.notes_nlp` | one per extracted entity | `person_key`, `note_key`, `entity_type`, `concept_text`, `negated`, `section` | monthly |
| `silver.features_*` | Feast offline feature tables | `person_key`, `event_ts`, feature columns | daily |

Silver is where the three patient identity spaces collapse to one: FHIR ids, MRNs (HL7), and
device registrations resolve to `person_key` in `bronze_to_silver` (deterministic match on MRN
identifier, with conflicts quarantined to a reconciliation table rather than guessed).

### 2.3 Gold — OMOP CDM v5.4 (dbt-spark)

Standard OMOP tables, built daily by `silver_to_omop`:

| Table | Built from | Notes |
|---|---|---|
| `gold.person` | `silver.patients` | `person_id` = surrogate int keyed off `person_key`; `year_of_birth` (shifted year per Safe Harbor retention) |
| `gold.observation_period` | encounter + observation spans | one continuous-coverage span per person |
| `gold.visit_occurrence` | `silver.encounters` | class → `visit_concept_id` (9201 inpatient / 9202 outpatient / 9203 ER); transfers stitched |
| `gold.condition_occurrence` | conditions | source code → standard SNOMED `condition_concept_id` via vocab tables |
| `gold.drug_exposure` | medications | RxNorm mapping |
| `gold.procedure_occurrence` | procedures | |
| `gold.measurement` | observations + vitals | LOINC → `measurement_concept_id`; vitals downsampled to clinically meaningful grain |
| `gold.observation` | non-measurement facts (incl. selected NLP output) | |
| `gold.death` | patient deceased data | |
| OMOP vocabulary tables (`concept`, `concept_relationship`, …) | Athena download, loaded once | versioned; refresh is a tracked event because it shifts groupers ([ml.md](ml.md#2-30-day-readmission--readmission-30d-xgboost)) |

Partitioning: event tables monthly on their date column; `person` and vocab unpartitioned.
dbt tests + GE provide the gate (below).

## 3. Delta features we actually use

| Feature | Where | Why |
|---|---|---|
| **ACID MERGE** | bronze upserts (offset-bookmarked landings), silver dedupe, gold dimension updates | idempotent re-runs; a retried Airflow task is a no-op, not a duplicate |
| **Time travel** | ML reproducibility & incident forensics | every training run logs the Delta **table versions** it read to MLflow, so `train-sepsis` is re-runnable against byte-identical inputs (`VERSION AS OF`); the [sepsis-alert-rate runbook](runbooks/sepsis-alert-rate-doubled.md) diffs current vs pre-incident feature tables the same way |
| **Schema enforcement / evolution** | all layers | source drift fails the write loudly instead of silently widening columns; intentional evolution is a reviewed `mergeSchema` commit |
| **Transaction log as audit** | promotion forensics | `DESCRIBE HISTORY` shows which job (Airflow run id is stamped in `userMetadata`) wrote which version |
| **Optimistic concurrency** | concurrent DAG writers | backfill and incremental runs can overlap partition-disjointly |
| **VACUUM with retention ≥ 30d** | storage hygiene | retention is deliberately long so time travel covers a full incident-investigation window |
| **Z-ordering** | `silver.observations`, `silver.vitals` on `person_key` | per-patient scans (feature building, cohort review) skip files |

What we deliberately don't rely on: Delta-only engines features (everything we use is readable
by Trino's delta connector — that constraint is part of [ADR-0001](adr/0001-lakehouse-on-delta.md)).

## 4. Great Expectations gates

GE checkpoints run **inside** the promoting DAG task; a failed expectation fails the task, so
nothing propagates — lakehouse freshness degrades, correctness doesn't
([architecture.md](architecture.md#6-failure-modes-by-layer)).

| Gate (checkpoint) | Runs in | Representative expectations |
|---|---|---|
| `bronze_landing` | each `*_to_bronze` DAG | row count > 0 when source offsets advanced; required columns non-null (`control_id`, `patient_id`, `study_uid`); `_ingest_date` matches run window |
| `silver_quality` | `bronze_to_silver` | uniqueness of natural keys post-dedupe (control_id, person/metric/ts); value ranges (HR 20–300, SpO₂ 50–100, temp 30–45); timestamp sanity (no future events, encounter end ≥ start); `person_key` non-null and matches HMAC format; **row-count delta within ±3σ of trailing 14-day mean** (the simulator-misconfig tripwire) |
| `omop_integrity` | `silver_to_omop` | every `visit_occurrence.person_id` ∈ `person`; every `*_concept_id` ∈ `concept` (standard, valid); `measurement.value_as_number` ranges per concept; table-level row deltas vs previous run; no `person` rows lost between runs |

Failed runs page per the [airflow-dag-failure runbook](runbooks/airflow-dag-failure.md); GE
validation results (data docs) are written alongside the checkpoint and linked from the Airflow
task log — the runbook's first diagnostic stop.

## 5. Why OMOP-over-FHIR for analytics

FHIR is the right *operational* canonical model and the wrong *analytical* one; OMOP is the
reverse. The argument (full trade-offs in [ADR-0002](adr/0002-omop-as-gold.md)):

1. **Shape.** FHIR is deeply nested resource-document shaped; cohort questions are relational
   ("patients with condition X and drug Y within 30 days of visit Z"). Flattening FHIR ad hoc
   per query reinvents a worse OMOP each time.
2. **Vocabulary.** OMOP forces mapping to standard concepts (SNOMED/RxNorm/LOINC) **once, at
   ETL time**, where GE can gate it — instead of every analyst handling local codes per query.
3. **Ecosystem.** OHDSI tooling, published phenotype definitions, and network-study queries run
   on OMOP as-is. An OMOP gold layer makes MedFlow's synthetic data a drop-in target for them.
4. **De-identification boundary.** The FHIR→silver→OMOP pipeline is exactly where pseudonyms
   and date shifts apply; researchers query OMOP and never touch the FHIR identity space —
   minimum-necessary by construction ([compliance.md](compliance.md#6-minimum-necessary--164502b-164514d)).
5. **Cost.** OMOP ETL is genuinely lossy (FHIR provenance nuance, extensions) and the vocab
   mapping is real work. That's why bronze keeps full FHIR JSON: anything OMOP dropped is one
   replay away, and FHIR-shaped analytics (rare) can read `bronze.fhir_changes` directly.

Freshness contract: ~1h to bronze, ~24h to OMOP — fine, because OMOP serves research and
quality analytics while the FHIR server serves care
([architecture.md](architecture.md#32-an-hl7-adt-messages-journey-to-omop)).

## 6. Lineage walkthrough (Marquez)

Every Airflow task and dbt model emits OpenLineage events to Marquez (API :5001, UI :3003,
namespace `medflow`). Worked example — "this Superset readmission chart looks wrong, where did
the number come from?":

1. **Start at the dataset.** Marquez UI → namespace `medflow` → dataset
   `delta.gold.visit_occurrence`. The lineage graph shows the producing job
   (`silver_to_omop.visit_occurrence` — the dbt model) and its inputs
   (`silver.encounters`, OMOP vocab).
2. **Walk upstream.** `silver.encounters` ← `bronze_to_silver.encounters` ←
   `bronze.fhir_changes` and `bronze.hl7_messages` ← the landing DAGs ← the Kafka topics.
   Column-level lineage answers the precise question: `visit_end_datetime` traces to
   `silver.encounters.end_ts` ← PV1-45 / `Encounter.period.end`.
3. **Check the runs, not just the graph.** Each job node lists run history with
   success/failure and row-count facets. A suspicious chart usually correlates with a
   particular run — note its time, then check the matching GE data docs and the Delta version
   it produced (`DESCRIBE HISTORY` ↔ run id in `userMetadata`).
4. **Reproduce.** Query the gold table `VERSION AS OF` the suspect run's output version vs the
   previous one in Trino; the diff localizes the change to a run, which localizes it to an
   input or a code change.

This is the loop the runbooks assume: Marquez tells you *which* hop, GE tells you *whether the
gate saw it*, Delta history tells you *exactly what changed*.

## 7. Query layer

Trino's `delta` catalog (`infra/docker/trino/catalog/delta.properties`) exposes all three
layers; Superset and the gateway's cohort API target **gold only** (enforced by Trino
catalog/schema rules — researchers' role maps to `delta.gold.*` exclusively, per
[compliance.md](compliance.md#32-rbac-roles)). Bronze/silver access is an engineering
capability, not an analyst one.
