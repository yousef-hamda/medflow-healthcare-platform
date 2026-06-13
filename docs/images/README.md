# MedFlow — screenshots & capture guide

This folder holds the architecture diagram ([`architecture.svg`](architecture.svg)) and the
screenshots/GIFs the top-level `README.md` embeds. All data shown is **synthetic** (Synthea,
simulated HL7v2/DICOM/vitals); capture freely — there is no real PHI.

> **Capture conventions**
> - Bring the stack up first: `make dev` (then `make sim-vitals` / `make seed-patients` as noted).
> - Use a **1440×900** viewport (or 2× retina) for stills; crop to the relevant panel.
> - Log in with the dev role the shot requires (`clinician`, `patient`, `auditor`, …).
> - **Scrub identifiers anyway** as hygiene practice even though data is synthetic — it models the
>   real workflow and keeps the screenshots reusable if data ever changes.
> - Save stills as PNG, animations as optimized GIF (≤ ~6 MB, ≤ 20 s, ~12 fps).
> - Keep filenames exactly as listed — `README.md` references them by name.

## Screenshots (10)

| # | Filename | Page / URL | What to show |
|---|---|---|---|
| 1 | `01-clinician-worklist.png` | Clinician dashboard, unit worklist (`:3000`) | The live unit worklist with sepsis scores per patient; at least one row red (active alert) and one `news2-fallback`-tagged row, so the model-vs-fallback provenance is visible. |
| 2 | `02-patient-sepsis-detail.png` | Clinician dashboard, patient view (`:3000`) | A single patient chart with the trending vitals sparkline (6h window) and the sepsis score card; show the score, model version, and a "why" link to the explanation. |
| 3 | `03-dicom-gradcam.png` | Clinician dashboard, imaging panel (`:3000`) | The Cornerstone DICOM viewer showing a chest X-ray with the **Grad-CAM overlay toggled on** (heatmap visible), and the "research-use-only" model badge. |
| 4 | `04-cohort-builder-trino.png` | Clinician dashboard, cohort builder (`:3000`) | A cohort query against OMOP gold (e.g. visit_occurrence + condition filter) with the result count and the generated Trino SQL panel — emphasizes the de-identified analytics path. |
| 5 | `05-audit-explorer.png` | Clinician dashboard, audit explorer (`:3000`, auditor role) | The audit trail for one patient: rows with actor, action, resource, justification — include a `BREAK_GLASS_OPEN` row with its justification text to show emergency-access auditing. |
| 6 | `06-patient-portal-disclosures.png` | Patient portal (`:3001`, patient role) | The patient's own record plus the "who accessed my record" disclosures list — the §164.528 accounting-of-disclosures gesture. |
| 7 | `07-superset-dashboard.png` | Superset (`:8088`) | An OMOP-backed analytics dashboard (e.g. encounters by visit type / readmission rate over time) — shows the BI surface on Trino + gold. |
| 8 | `08-marquez-lineage.png` | Marquez lineage UI (`:3003`) | The column-level lineage graph from a source topic → bronze → silver → OMOP → a Superset dataset; click a `visit_occurrence` field to show the trace. |
| 9 | `09-grafana-observability.png` | Grafana (`:3002`) | A MedFlow dashboard panel set: service request rates/latency, Kafka consumer lag (esp. `vitals.raw` / Flink), and the sepsis alert-rate panel with its baseline. |
| 10 | `10-mlflow-registry.png` | MLflow UI (`:5000`) | The model registry showing the three registered models (`sepsis-ews`, `readmission-30d`, `chest-xray-14`) with a Production stage and a metrics comparison (e.g. AUROC) across versions. |

## GIFs (3)

| # | Filename | Page / flow | What to show |
|---|---|---|---|
| A | `gif-01-live-sepsis-alert.gif` | Worklist (`:3000`) while `make sim-vitals` runs | The end-to-end realtime path live: a simulated patient trends septic, a vitals window fires, and the worklist row flips to red via the Socket.IO push — capture from "stable" to "alert" (~10–15 s). |
| B | `gif-02-break-glass.gif` | Clinician dashboard (`:3000`) | The break-glass flow: a clinician tries to open a non-care-team patient, is blocked, requests break-glass, **types a justification**, gets the 1-hour elevation, and the chart unmasks — then show the resulting `BREAK_GLASS_OPEN` audit row. |
| C | `gif-03-deid-before-after.gif` | deid-service demo (`:8093`) or a notebook calling `/deid/text` | A clinical free-text note submitted to the de-id endpoint, showing **before → after**: names/MRN/phone redacted, dates shifted (interval preserved), ZIP3 truncated, age 90+ aggregated — the Safe Harbor transform made visible. |

## Notes for the README author

- The architecture SVG is hand-authored and standalone; embed it directly (`![Architecture](docs/images/architecture.svg)`).
- Shots 1–6 are the "clinical safety + governance" story; 7–10 are the "data platform + MLOps"
  story; the three GIFs are the demo hooks (realtime alerting, break-glass auditing, de-id).
- If you re-capture after a UI change, keep the same framing so the README narrative still reads.
