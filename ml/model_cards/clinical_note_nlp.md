# Model Card — Clinical Note NLP (`clinical-note-nlp`)

> **SYNTHETIC DATA / NOT FOR CLINICAL USE.** Built and demonstrated on synthetic
> clinical notes only (Synthea-derived narratives). Reference implementation for
> MedFlow — not validated on real notes, not for clinical use.

## Model details

- **Name / version:** `clinical-note-nlp`, v0.1.0.
- **Type:** Rule- and dictionary-driven clinical NLP pipeline built on
  **medspaCy** — sentence segmentation, target-concept matching (problems,
  medications, allergies) and **ConText**-based negation/assertion detection.
  See `medflow_serving/inference/nlp.py`.
- **Input:** free-text clinical note (already de-identified upstream).
- **Output:** entities with a redacted text span, label
  (`PROBLEM` / `MEDICATION` / `ALLERGY`), optional concept code, and a `negated`
  assertion flag.

## Intended use

- **In scope:** demonstrating clinical entity extraction with assertion/negation
  on synthetic notes; surfacing structured problems/medications/allergies for
  downstream demos.
- **Out of scope:** real clinical documentation, decision support, coding/billing
  or any patient determination; languages other than English; note types unlike
  the synthetic samples; running on text that has not been de-identified.

## Training / configuration data

- **Source:** synthetic notes generated from Synthea encounters (seed 42) and
  hand-authored test notes. **No real notes, no PHI.** The pipeline is primarily
  rule/dictionary-based; "training" here means curating target rules and the
  concept dictionary rather than gradient learning.
- **De-identification:** notes are de-identified by the upstream `deid-service`
  before NLP; output spans are redacted.

## Features

Lexical/rule features: target-rule literal/regex matches, sentence boundaries,
and ConText assertion cues (negation, historical, hypothetical, family).

## Metrics

*Example results on a small synthetic annotation set — illustrative only.*

| Task | Precision | Recall | F1 |
| --- | --- | --- | --- |
| Problem extraction | 0.88 | 0.81 | 0.84 |
| Medication extraction | 0.90 | 0.85 | 0.87 |
| Allergy extraction | 0.86 | 0.78 | 0.82 |
| Negation detection | 0.91 | 0.88 | 0.89 |

## Subgroup fairness

Protected attributes (sex / age band / race) are **note-level metadata**, not
NLP inputs. On the synthetic set, extraction F1 varies within ±0.03 across sex
and age bands (illustrative). The pipeline should be re-checked for differential
performance whenever the note distribution changes; race-stratified results are
not meaningful on synthetic notes.

## Failure modes

- **Vocabulary gaps:** dictionary-based matching misses paraphrases, misspellings
  and novel drug names (recall ceiling).
- **Assertion errors:** complex/nested negation and hedging ("cannot rule out")
  can be mis-scoped by ConText rules.
- **De-id dependence:** correctness assumes upstream de-identification; raw PHI
  must never reach this pipeline.
- **Domain shift:** real note styles/abbreviations differ from synthetic ones.

## Monitoring plan

- Track entity yield and negation rates per note type for drift.
- Periodic human review of a sampled output set against gold annotations.
- Alert on dictionary/version changes that shift extraction volume.

## Retraining / update cadence

Rules and the concept dictionary are reviewed on a release cadence (e.g.
quarterly) or when new note types/terminologies appear. Re-validate on the
annotation set before promotion.

## Limitations

Synthetic data only; rule/dictionary coverage is finite; assertion logic is
heuristic; English-only; not a clinical or coding tool.

## Citations

- Eyre H, et al. *Launching into clinical space with medspaCy: a new clinical
  text processing toolkit in Python.* AMIA Annual Symposium Proceedings, 2021.
