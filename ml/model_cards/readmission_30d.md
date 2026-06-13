# Model Card — 30-Day Readmission Risk (`readmission-30d`)

> **SYNTHETIC DATA / NOT FOR CLINICAL USE.** Trained and evaluated entirely on
> synthetic patients (Synthea, seed 42). Reference implementation only — not
> FDA-cleared, not validated on real patients, not for care decisions.

## Model details

- **Name / version:** `readmission-30d`, v0.1.0 (MLflow registry).
- **Type:** Gradient-boosted trees — XGBoost (`binary:logistic`) with isotonic
  probability calibration on a temporal validation fold. SHAP `TreeExplainer`
  for attributions. See `medflow_ml/jobs/train_readmission.py`.
- **Input:** an encounter feature row (`medflow_ml.features.encounters`).
- **Output:** probability `[0, 1]` of an inpatient readmission within 30 days of
  discharge, a risk band, and top-5 SHAP attributions.

## Intended use

- **In scope:** demonstrating tabular risk modeling with calibration, SHAP and
  subgroup fairness on synthetic discharges; care-management prioritization
  *demos*.
- **Out of scope:** real discharge planning, benefits/coverage decisions, or any
  individual patient determination; populations or care settings unlike the
  synthetic cohort; use without local revalidation and governance review.

## Training data

- **Source:** Synthea synthetic encounters (seed 42) in the OMOP gold
  lakehouse. **No real patients, no PHI.**
- **Cohort:** `readmission_index` — inpatient discharges alive at discharge,
  non-transfer. Label = another inpatient visit within 30 days of discharge.
- **Split:** temporal hold-out by index discharge date with XGBoost early
  stopping on the validation fold.

## Features (`FEATURE_ORDER`)

age, sex, length of stay, prior-admission counts (90/180/365d, **strictly
historical** look-backs), diagnosis count, comorbidity flags (heart failure,
COPD, diabetes, CKD, cancer, dementia from ICD-10 prefixes), discharge
disposition and social-support indicator. Shared with serving via
`medflow_serving.inference.readmission`. Anti-leakage of the look-back windows
is enforced by `test_leakage_guard.py`.

## Metrics

*Example results on the Synthea seed-42 validation fold — illustrative only.*

| Metric | Value |
| --- | --- |
| AUROC | 0.72 |
| AUPRC | 0.33 |
| ECE (10-bin, post-calibration) | 0.03 |
| Sensitivity @ 0.3 | 0.68 |
| Specificity @ 0.3 | 0.66 |

For comparison the model card references the **LACE** index and **HOSPITAL**
score as established clinical baselines (citations below).

## Subgroup fairness

*Example subgroup AUROC on the synthetic validation fold — illustrative only.*

| Subgroup | AUROC | Notes |
| --- | --- | --- |
| Sex: female | 0.71 | |
| Sex: male | 0.73 | |
| Age 18–39 | 0.70 | low base rate |
| Age 40–64 | 0.72 | |
| Age 65–74 | 0.73 | |
| Age 75+ | 0.71 | |
| Race (synthetic categories) | 0.69–0.74 | wide CIs at small n |

Calibration-by-group reviewed in `07_evaluation_and_fairness.ipynb`.

## Failure modes

- **Social-determinant features** are coarse/synthetic; real-world equivalents
  carry equity risk and require careful sourcing.
- **Selection bias:** the index cohort excludes deaths/transfers; generalization
  beyond it is unsupported.
- **Calibration drift** under changing admission patterns; recalibrate on drift.
- **Comorbidity flags** depend on ICD-10 coding completeness.

## Monitoring plan

- Evidently drift report on serving feature distributions vs the training
  baseline; alert on age/LOS/prior-admission drift.
- Track calibration (ECE) and subgroup AUROC on labeled 30-day outcomes.
- Monitor SHAP feature-importance stability across retrains.

## Retraining cadence

Quarterly, or on drift alert / coding-system change. Re-calibrate and re-run
fairness checks before promotion.

## Limitations

Synthetic data only; not clinically validated; risk scores are not causal and
must not be used to deny care.

## Citations

- van Walraven C, et al. *Derivation and validation of an index to predict early
  death or unplanned readmission after discharge from hospital to the community
  (LACE).* CMAJ, 2010.
- Donzé J, et al. *Potentially avoidable 30-day hospital readmissions in
  medical patients: derivation and validation of a prediction model
  (HOSPITAL).* JAMA Internal Medicine, 2013.
