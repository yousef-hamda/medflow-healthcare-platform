# MedFlow — `medflow_omop` (dbt-spark, OMOP CDM v5.4)

Transforms the MedFlow **silver** Delta tables into the **gold** layer modelled
on the **OMOP Common Data Model v5.4**. Run by the Airflow `silver_to_omop` DAG
(`dbt build` via a `BashOperator`) and gated afterwards by Great Expectations.

```
silver/{patients,encounters,observations,medications,imaging_studies,notes_deid}
        │  (dbt-spark, Spark Thrift server → spark://spark-master:7077)
        ▼
staging (views)  stg_patients … stg_notes
        ▼
marts/omop (Delta tables → s3://lakehouse/gold/<table>)
  person · visit_occurrence · condition_occurrence · drug_exposure ·
  measurement · observation · procedure_occurrence · note · note_nlp
```

## Why OMOP, not FHIR, for analytics

FHIR is a great **interchange / API** model: deeply nested, resource-centric,
optimised for transactional exchange between systems. It is awkward for
analytics — every question becomes a recursive walk through references and
extensions, codes live in many vocabularies, and there is no canonical join key.

OMOP CDM is a **research/analytics** model:

- **Flat, person-centric, relational** — `person` is the hub; every clinical
  event (visit, condition, drug, measurement, …) is a flat fact table with a
  `person_id` FK, so cohort queries are simple joins, not graph traversals.
- **Standardised vocabularies** — source codes (SNOMED/RxNorm/LOINC) are mapped
  to a single set of **standard concept ids**, so "all patients on a statin" or
  "all diabetics" is one predicate regardless of the source coding system.
- **Tool ecosystem** — ATLAS/OHDSI cohort definitions, Achilles data
  characterisation and standardised analytics run unmodified on a valid CDM.

So FHIR/HL7 stay the ingestion contract (bronze/silver); OMOP is the queryable
gold layer the cohort builder, Superset dashboards and ML feature jobs read.

## Concept mapping

Source→standard concept ids come from the seeds (real codes):

| Seed | Maps | Example |
| --- | --- | --- |
| `concept_map_conditions` | SNOMED → OMOP condition concept | 44054006 (T2DM) → 201826; 38341003 (hypertension) → 320128 |
| `concept_map_meds` | RxNorm → OMOP drug concept | 860975 (metformin 500 MG) → 40163924 |
| `concept_map_labs` | LOINC → OMOP measurement concept (+ unit) | 8867-4 (heart rate) → 3027018, unit 8541 |

Unmapped source codes resolve to `concept_id = 0` ("No matching concept") and
keep their original code in the `*_source_value` column for later mapping. In
production these seeds are replaced by the full OHDSI vocabulary tables (Athena).

## Keys

Surrogate OMOP integer keys are deterministic hashes of the FHIR string ids
(`macros/generate_person_id.sql`): the same source row always yields the same
`person_id` / `visit_occurrence_id` across full refreshes and across tables, so
referential joins hold without a sequence/registry.

## Running

```bash
cp profiles.yml.example ~/.dbt/profiles.yml   # or set DBT_PROFILES_DIR=.
dbt deps                                       # dbt_utils (accepted_range, ...)
dbt seed                                        # load concept maps
dbt build --target spark                        # staging + marts + schema tests
```

The Airflow DAG runs `dbt build` (which is `run` + `test` + `seed` + `snapshot`)
so the schema.yml tests (`not_null`/`unique` on `person_id`, `relationships`
person↔events, `accepted_values` on `gender_concept_id`, `accepted_range` on
`year_of_birth`) are enforced as part of the gold build.

## Layout

```
dbt_project.yml          project + materialisation config
packages.yml             dbt_utils dependency
profiles.yml.example     spark thrift connection (copy to ~/.dbt)
models/
  sources.yml            silver Delta sources
  schema.yml             gold mart tests
  exposures.yml          Superset dashboards (lineage)
  staging/               stg_* views (one per silver entity)
  marts/omop/            the nine OMOP CDM tables
seeds/                   concept_map_{conditions,meds,labs}.csv
macros/generate_person_id.sql
```
