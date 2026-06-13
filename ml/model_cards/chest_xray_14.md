# Model Card — Chest X-ray 14-Finding Classifier (`chest-xray-14`)

> **RESEARCH USE ONLY / NOT FOR CLINICAL USE.** Trained on the **NIH
> ChestX-ray14** dataset, which the NIH Clinical Center releases for **research
> use only**. This model is a reference implementation; it is **not**
> FDA-cleared, not a diagnostic device, and must never drive patient care. No
> images are redistributed in this repository.

## Model details

- **Name / version:** `chest-xray-14`, v0.1.0 (MLflow registry).
- **Type:** DenseNet121 (ImageNet-pretrained) with the classifier replaced by a
  14-unit sigmoid head; `BCEWithLogitsLoss` with per-label `pos_weight`. Grad-CAM
  for localization heatmaps. See `medflow_ml/jobs/train_xray.py`.
- **Input:** a single frontal chest radiograph (resized, normalized).
- **Output:** 14 independent finding probabilities `[0, 1]` + a Grad-CAM
  overlay (PNG).

## Intended use

- **In scope:** demonstrating multi-label medical-image classification, transfer
  learning, per-label AUROC evaluation and Grad-CAM explainability on a public
  research dataset.
- **Out of scope:** any clinical reading, triage, or diagnosis; non-frontal or
  pediatric films; lateral views; deployment on real clinical images without
  prospective validation and regulatory clearance.

## Training data

- **Source:** NIH ChestX-ray14 (Wang et al., 2017) — ~112k frontal chest X-rays,
  14 labels NLP-mined from radiology reports (**noisy labels**). Research use
  only; pointed at by `CHESTXRAY_DIR`. **No PHI is added; no images committed.**
- **Labels:** Atelectasis, Cardiomegaly, Effusion, Infiltration, Mass, Nodule,
  Pneumonia, Pneumothorax, Consolidation, Edema, Emphysema, Fibrosis,
  Pleural_Thickening, Hernia.
- **Split:** patient-disjoint train/validation split (no patient appears in
  both) to avoid identity leakage.

## Features

Raw pixels (no hand-crafted features); standard ImageNet normalization and
augmentation.

## Metrics

*Example per-label AUROC on a patient-disjoint validation split — illustrative
only, NIH ChestX-ray14.*

| Finding | AUROC | Finding | AUROC |
| --- | --- | --- | --- |
| Cardiomegaly | 0.89 | Pneumothorax | 0.85 |
| Edema | 0.88 | Consolidation | 0.79 |
| Effusion | 0.86 | Pneumonia | 0.73 |
| Atelectasis | 0.80 | Nodule | 0.74 |
| Emphysema | 0.84 | Mass | 0.78 |
| Fibrosis | 0.78 | Infiltration | 0.69 |
| Hernia | 0.86 | Pleural_Thickening | 0.76 |

Mean AUROC ≈ 0.80, consistent with the CheXNet-era literature on this dataset.

## Subgroup fairness

*Example subgroup mean-AUROC on the validation split — illustrative only.*

| Subgroup | Mean AUROC | Notes |
| --- | --- | --- |
| Sex: female | 0.80 | |
| Sex: male | 0.81 | |
| Age <40 | 0.79 | |
| Age 40–64 | 0.80 | |
| Age 65+ | 0.81 | |

Race is **not** available in ChestX-ray14, so race-based fairness cannot be
assessed for this model — a documented limitation.

## Failure modes

- **Label noise:** report-mined labels are imperfect; some findings co-occur and
  are positionally ambiguous.
- **Shortcut learning:** models can latch onto scanner/portable-marker artifacts
  rather than pathology; Grad-CAM should be sanity-checked.
- **Domain shift:** different hospitals/equipment degrade performance sharply.
- **Single-view limitation:** frontal-only; many findings need lateral views.

## Monitoring plan

- Track per-label AUROC and calibration on any labeled feedback.
- Monitor input-image statistics (intensity, size) for acquisition drift.
- Periodic Grad-CAM spot-checks for shortcut behaviour.

## Retraining cadence

Re-train when the underlying dataset/version changes or on acquisition drift.
Re-run per-label and subgroup evaluation before promotion.

## Limitations

Research dataset with noisy labels; not a diagnostic device; no race attribute
for fairness analysis; frontal single-view only.

## Citations

- Wang X, et al. *ChestX-ray8: Hospital-scale chest X-ray database and
  benchmarks on weakly-supervised classification and localization of common
  thorax diseases.* CVPR, 2017.
- Rajpurkar P, et al. *CheXNet: Radiologist-level pneumonia detection on chest
  X-rays with deep learning.* arXiv:1711.05225, 2017.
