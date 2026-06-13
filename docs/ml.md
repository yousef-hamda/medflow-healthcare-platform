# MedFlow ML Platform

> Companion to [architecture.md](architecture.md) §2.6. This document covers the four model
> families end to end: problem framing, features, training, evaluation (with the time-aware
> splits and leakage guards that make clinical eval honest), serving, canary mechanics, drift
> monitoring, and retraining triggers. Per-model cards live in
> [`ml/model_cards/`](../ml/model_cards/) — `sepsis-ews.md`, `readmission-30d.md`,
> `chest-xray-14.md`, `clinical-nlp.md` — and are the artifact of record for intended use and
> limitations; this doc is the engineering view.
>
> All models are trained on **synthetic** (Synthea-derived) or research-licensed
> (NIH ChestX-ray14) data. None is validated for clinical use; the CXR model is explicitly
> **research-use-only** per its dataset license.

## 0. Platform invariants (apply to every model)

- **Registry:** MLflow (:5000, Postgres backend, artifacts in MinIO `mlflow-artifacts`).
  Registered names: `sepsis-ews`, `readmission-30d`, `chest-xray-14`. Serving resolves
  models by registry **stage/alias**, never by file path — promotion is a registry operation,
  not a deploy.
- **Features:** Feast — offline store on Delta (lakehouse silver/features), online store in
  Redis, materialized daily by the `feature_backfill` DAG
  ([architecture.md](architecture.md#25-lakehouse-and-batch)). Training and serving read the
  *same feature definitions* from `ml/feature_repo/`; that single source is the main
  training/serving-skew defense.
- **Prediction logging:** ml-serving (:8094) writes every scored request to the `predictions`
  Postgres DB and Kafka topic — features hash, score, model version, canary arm, latency. This
  is what makes canary comparison, drift monitoring, and post-hoc label joins possible.
- **Explainability:** SHAP for the tabular models (logged per-prediction for high scores,
  on-demand otherwise), Grad-CAM overlays for the CXR model. Explanation artifacts may embed
  clinical values and are access-controlled accordingly
  ([compliance.md](compliance.md#1-phi-inventory--164308a1iia-input)).
- **Drift:** Evidently jobs compare serving-time feature/score distributions (from the
  `predictions` stream) against the training reference; HTML/JSON reports land in MinIO
  `drift-reports` and headline metrics export to Prometheus.

## 1. Sepsis early warning — `sepsis-ews` (LSTM)

**Problem framing.** Per-patient, per-window binary risk: given the last 6 hours of vitals,
estimate the probability of sepsis onset in the next 6 hours. Onset label: a Sepsis-3-style
proxy computed from the synthetic record (suspected infection + SOFA-equivalent deterioration);
on Synthea data the label is partly constructed by the vitals simulator's sepsis trajectories —
stated plainly in the model card because it bounds what the eval can claim.

**Features.** The Flink job's 6h/15min window vector: for HR, RR, SBP, SpO₂, temp, level of
consciousness — last value, window mean, min/max, slope, and time-since-last-reading; plus age
band and a missingness mask per channel (missingness is informative — instrumented patients are
sicker). No labs in v1 (vitals-only keeps the streaming path self-contained); lab extension is
a backlog item.

**Training path.** `make train-sepsis` → `ml-batch python -m medflow_ml.jobs.train_sepsis`:
reads windowed features from the Feast offline store (silver vitals), builds sequences (24
steps × 15min), trains the LSTM (PyTorch), logs params/metrics/artifacts to MLflow, registers a
new version of `sepsis-ews`.

**Eval protocol.**
- **Time-aware split:** train on windows up to T₀, validate on (T₀, T₁], test on (T₁, T₂] —
  never a random row split, which would put a patient's hour-3 window in train and hour-4 in
  test. Additionally **grouped by patient**: a patient appears in exactly one split.
- **Leakage guards:** (1) every feature is computed from data timestamped ≤ window end —
  enforced by Feast point-in-time joins, not by convention; (2) the label window starts strictly
  after the feature window; (3) no post-onset windows in training negatives (a patient already
  septic is not a "negative"); (4) the dedupe/alert logic is excluded from eval — we evaluate
  the score, not the alerting policy, then evaluate the policy separately as alert
  precision/volume.
- **Metrics:** AUROC and AUPRC (prevalence is low, so AUPRC headlines), plus
  **alert-burden curves** (alerts per 100 patient-days vs sensitivity at the deployed
  threshold) — the clinically honest metric, and the one the
  [sepsis-alert-rate runbook](runbooks/sepsis-alert-rate-doubled.md) leans on. Calibration
  (reliability diagram + Brier) is logged because the CDS card shows the raw probability.
- **Baseline gate:** a candidate must beat NEWS2 on AUPRC at matched alert burden, otherwise
  the fallback rule is strictly better and promotion is refused.

**Serving path.** Flink → `POST /predict/sepsis` with the window vector; ml-serving fills any
missing online features from Feast/Redis, scores, logs, returns
`{score, model_version, explanation_ref}`. Unavailability degrades to the deterministic NEWS2
fallback inside Flink, tagged `news2-fallback`
([architecture.md](architecture.md#24-stream-processing--the-sepsis-job)).

**Retraining triggers.** Any of: Evidently feature drift (PSI > 0.2 on ≥2 core vitals
channels for 7 consecutive days), score-distribution drift, alert precision (from clinician
ack/dismiss feedback) dropping below floor, or 90 days elapsed. Retraining is
human-initiated from those signals — no auto-promote.

## 2. 30-day readmission — `readmission-30d` (XGBoost)

**Problem framing.** At discharge time: probability of unplanned readmission within 30 days.
Scored synchronously by the `readmission-risk` CDS hook on `encounter-discharge`
([interop.md](interop.md#64-readmission-risk--requestresponse-abridged)).

**Features.** Tabular, from OMOP gold via Feast offline: prior utilization (admission counts
6/12mo, ED visits, cumulative LOS), index-stay features (LOS, discharge disposition, service),
diagnosis groupers (CCSR-style categories from `condition_occurrence`), medication count at
discharge, age band, and payer-type proxy. **Everything point-in-time as of the discharge
instant** — a feature computed from data after discharge is the classic readmission leak.

**Training path.** `make train-readmission`: cohort SQL over OMOP gold (index admissions with
≥30 days of follow-up coverage), Feast point-in-time join, XGBoost with early stopping on the
temporal validation fold, SHAP summary artifact, register to MLflow.

**Eval protocol.**
- **Time-aware split** on discharge date (train ≤ T₀ < valid ≤ T₁ < test), grouped by patient.
- **Leakage guards:** label requires observability (patients without 30 days of post-discharge
  coverage are excluded, not labeled negative); planned readmissions excluded from the positive
  label; same-day transfers stitched into one visit during `silver_to_omop` so a transfer
  doesn't count as a readmission; death within 30 days handled as censoring, not negative.
- **Metrics:** AUROC, AUPRC, calibration, and **decile lift** (the deployment question is "is
  the top quartile worth a care-transition intervention", which is how the CDS card phrases it).
- **Subgroup report:** performance by age band and sex logged per training run — a fairness
  smoke check, with the honest caveat that Synthea demographics make it a process rehearsal,
  not a validity claim.

**Serving, drift, retraining.** Synchronous REST; low volume (one call per discharge), so
canary windows are long (see §5). Evidently drift on the feature set monthly; retrain on drift,
calibration decay (observed-vs-predicted by decile once labels mature at +30 days), or
OMOP vocabulary refresh that changes the diagnosis groupers.

## 3. Chest X-ray classification — `chest-xray-14` (DenseNet121 + Grad-CAM)

**Problem framing.** Multi-label classification over the 14 ChestX-ray14 findings on frontal
CXR. **Research-use-only**: the dashboard renders it inside the viewer with an explicit RUO
banner; it feeds no alerts and no CDS hooks.

**Features / input.** DICOM pixel data from MinIO `imaging` → preprocessing
(`apps/dicom-receiver` pipeline normalizes; training-side transforms in `ml-batch`): grayscale,
resize 224×224, ImageNet-stats normalization. NIH labels come from `make download-chestxray`.

**Training path.** `make train-xray`: fine-tune torchvision DenseNet121 (ImageNet weights),
binary-cross-entropy over 14 heads, log per-class AUROC to MLflow, register.

**Eval protocol.**
- **Patient-level split** (the published ChestX-ray14 patient lists) — image-level random
  splits leak the same patient's serial films across train/test and inflate AUROC, a
  well-known failure of early work on this dataset.
- **Leakage guards:** no view-position or hospital-device shortcut features; per-class AUROC
  reported against the official test list only; label noise (NLP-mined labels) stated in the
  model card as a ceiling on claims.
- **Grad-CAM sanity review:** a sampled grid of overlays per class is logged as an MLflow
  artifact and eyeballed before promotion — attention on laterality markers or tubes rather
  than parenchyma is an automatic reject.

**Serving path.** `POST /predict/cxr` with a study/instance reference; ml-serving fetches
pixels from MinIO, returns per-class probabilities + a Grad-CAM PNG reference the dashboard
overlays in the Cornerstone viewer.

**Drift / retraining.** Evidently on score distributions plus simple input-stats drift
(pixel-intensity histograms, image-size mix) — image drift detection is weaker than tabular;
the card says so. Retrain on dataset refresh, not on a clock.

## 4. Clinical NLP — medspaCy pipelines

Not a registered predictive model — a deterministic pipeline (target rules + ConText for
negation/temporality/experiencer) that extracts problems/medications/findings from
DocumentReference notes. Output feeds the OpenSearch index **after** de-identification
([compliance.md](compliance.md#5-de-identification--164514b)) and an `observation`-style
structured sidecar in silver. Evaluated against a small hand-annotated synthetic-note set
(precision/recall per entity type, negation accuracy) checked into `ml/data/`; versioned by
ruleset hash rather than MLflow stage. The honest caveat: ConText-style rules transfer poorly
across note styles, so the eval set must be re-annotated if the note generator changes.

## 5. Canary mechanics

Promotion to production traffic is gated by a canary, not a flag flip:

1. A candidate version is registered and tagged `canary` in MLflow; the incumbent stays
   `production`.
2. ml-serving routes by **patient-ID hash**: `hash(patient_id) mod 100 < CANARY_PERCENT` →
   candidate; else incumbent. Hashing by *patient* (not request) means a given patient's
   serial windows are scored by one arm — score trajectories stay coherent for clinicians and
   the dedupe logic, and arm assignment is reproducible after the fact from the patient ID
   alone.
3. Every prediction logs its arm to the `predictions` stream; the comparison job reads both
   arms over the same period and compares score distributions, alert rates, latency, and — once
   labels mature — discrimination.
4. Promote (`canary` → `production` in the registry; serving picks it up on its refresh
   interval) or roll back (delete the tag; instant, no deploy).

`CANARY_ENABLED=false` in local compose; the path is exercised in kind/AWS tiers
([deployment.md](deployment.md)). Guardrail: the alert-rate alarm in the
[sepsis-alert-rate runbook](runbooks/sepsis-alert-rate-doubled.md) evaluates **per arm**, so a
bad canary trips on its own slice without doubling the page volume for everyone.

## 6. Drift monitoring, concretely

| Signal | Source | Tool | Threshold → action |
|---|---|---|---|
| Feature drift (tabular) | `predictions` stream vs training reference | Evidently (PSI/KS per feature) | PSI > 0.2 on core features, 7d sustained → investigate, consider retrain |
| Score drift | `predictions` | Evidently | distribution shift alarm → check upstream data first (see runbook triage order) |
| Alert rate | `alerts` topic / Prometheus | recording rule per model version + arm | >2× 7-day baseline → page, [runbook](runbooks/sepsis-alert-rate-doubled.md) |
| Label-delayed performance | predictions ⋈ outcomes in gold | scheduled notebook/DAG | AUPRC or calibration below floor → retrain gate |
| Serving health | OTel/Prometheus | latency, error rate, fallback rate | `news2-fallback` ratio > 5% → serving incident, not model incident |

Reports: MinIO `drift-reports` (HTML for humans, JSON for machines), headline gauges in
Grafana. The triage order — **model vs data vs population** — is deliberately encoded in the
runbook rather than automated, because the correct response differs: a simulator/config change
masquerades as population drift, and retraining on it would launder a bug into the model.

## 7. Honest limitations

- Synthea vitals and the sepsis simulator make `sepsis-ews` evaluation circular to a degree no
  metric fixes; the platform demonstrates the *machinery* (point-in-time features, time-aware
  eval, canary, drift), not clinical validity.
- Readmission labels inherit Synthea's utilization model, which is smoother than reality.
- ChestX-ray14 labels are NLP-mined and noisy; DenseNet121 AUROC numbers are not comparable to
  radiologist performance claims.
- None of the models has prospective validation, site generalization evidence, or regulatory
  clearance — see each model card's "Out-of-scope uses" section in
  [`ml/model_cards/`](../ml/model_cards/).
