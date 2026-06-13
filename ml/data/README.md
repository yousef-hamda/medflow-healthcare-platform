# ml/data

Local landing zone for ML datasets and small samples. **Everything here is
synthetic or research-use-only; no PHI ever lands here.**

## What lands where

| Path | Contents | Source |
| --- | --- | --- |
| `sample/` | Tiny synthetic samples committed for notebooks/tests (e.g. `vitals_sample.csv`). | Synthea (seed 42), hand-trimmed |
| `feature_store/` | Local mirror of offline feature parquet for `feast apply` / `materialize` (git-ignored). | `medflow_ml.jobs.backfill_features` |
| `chestxray14/` | NIH ChestX-ray14 mirror: `Data_Entry_2017.csv` + `images/` (git-ignored; pointed at by `CHESTXRAY_DIR`). | NIH Clinical Center (research use only) |
| `registry.db` | Feast SQL registry (git-ignored). | `feast apply` |

Only `sample/` is committed. The rest is generated/downloaded locally and
excluded from git.

## Dataset licenses

- **Synthea** — synthetic patient generator. Output data is fully synthetic
  (no real patients) and is distributed under permissive terms (Apache-2.0 for
  the generator). Safe to commit small samples. We use seed 42 for
  reproducibility.
- **NIH ChestX-ray14** (Wang et al., 2017) — released by the NIH Clinical
  Center for **research use only**. It is **not** cleared for clinical use and
  must not drive patient-care decisions. The labels are NLP-mined from
  radiology reports and are noisy. **This repository ships no ChestX-ray14
  images**; only code that reads a local mirror at `CHESTXRAY_DIR`.
  Redistribution is governed by the NIH terms — see
  <https://nihcc.app.box.com/v/ChestXray-NIHCC>. Use `make download-chestxray`
  to fetch a small slice locally.

## Reminder

These datasets back research/demo models only. None of the trained models in
MedFlow are FDA-cleared or intended for clinical decision-making.
