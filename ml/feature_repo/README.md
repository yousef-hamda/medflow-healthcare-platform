# MedFlow Feature Repo (Feast)

Feast feature definitions for MedFlow's online/offline feature store. **All
features are derived from synthetic data (Synthea, seed 42).** No PHI.

## Layout

| File | Purpose |
| --- | --- |
| `feature_store.yaml` | Store config: project `medflow`, SQL registry at `data/registry.db`, online store Redis (`redis:6379`), offline store `file`. |
| `entities.py` | The `patient` entity (join key `patient_id`, a Synthea person id). |
| `features.py` | Feature views: `vitals_stats_1h/6h/24h`, `encounter_history`, `lab_flags`, each backed by a `FileSource` pointing at lakehouse parquet. |

## Feature views

- **`vitals_stats_1h` / `_6h` / `_24h`** — rolling `mean`/`min`/`max`/`slope`
  for each of the five vitals (`heart_rate`, `spo2`, `resp_rate`, `temp_c`,
  `map_mmhg`) over the named window. Produced by
  `medflow_ml.jobs.backfill_features` using the shared pure functions in
  `medflow_ml.features.vitals` (so offline == online == training-time).
- **`encounter_history`** — prior admission counts (90/180/365 day look-backs),
  length of stay, diagnosis count and age. Look-backs are strictly historical.
- **`lab_flags`** — `{lab}_low` / `{lab}_high` / `{lab}_abnormal` integer flags
  for eight labs, following `medflow_ml.features.labs.lab_flag_field_names()`.

## Data sources

The `FileSource` paths point at the offline feature store the backfill job
writes (`s3://lakehouse/feature_store/<name>.parquet`). For a local
`feast apply` / `feast materialize` run, mirror those parquet files under
`ml/feature_repo/data/feature_store/` or repoint the sources at the S3 URIs.

## Usage

```bash
cd ml/feature_repo
feast apply                       # register entities + feature views
feast materialize-incremental $(date -u +%Y-%m-%dT%H:%M:%S)   # offline -> Redis
```

The backfill job calls `feast materialize` automatically after writing the
offline parquet; see `apps/ml-batch/src/medflow_ml/jobs/backfill_features.py`.

> Point-in-time correctness: every feature event timestamp reflects data
> observed strictly before it, so historical joins for training never leak
> future information.
