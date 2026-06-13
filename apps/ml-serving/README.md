# ml-serving — MedFlow multi-model inference service

FastAPI service exposing four clinical ML endpoints backed by the MLflow
model registry, with deterministic canary routing, SHAP explanations, an
append-only tamper-evident predictions log, and a documented rule-based
**cold-start mode** so the stack works before any model has been trained.

> **All data is synthetic** (Synthea EHR + NIH ChestX-ray14). This service
> never handles real PHI in development, and its logging/persistence layer is
> written as if it did: raw patient identifiers and note text are never
> logged or stored — only salted one-way hashes (`logging_utils.hash_id`).

## Endpoints

| Route | Model (MLflow name) | Notes |
|---|---|---|
| `POST /predict/sepsis` | `sepsis-ews` | 6 h vitals window → LSTM risk score, bands at 0.3 / 0.6, SHAP top-5 |
| `POST /predict/readmission` | `readmission-30d` | encounter features → calibrated XGBoost probability, TreeSHAP top-5 |
| `POST /predict/chest-xray` | `chest-xray-14` | multipart DICOM/PNG → 14 NIH label probabilities + Grad-CAM PNG (base64) |
| `POST /nlp/notes` | medspaCy pipeline | target rules + ConText negation; spans returned redacted to lexicon terms |
| `GET /healthz` | — | loaded model versions per track |

Example:

```bash
curl -s localhost:8094/predict/sepsis -H 'content-type: application/json' -d '{
  "patient_id": "synthea-0001",
  "vitals_window": [{"ts": "2026-06-11T10:00:00Z", "heart_rate": 118, "spo2": 91,
                     "resp_rate": 26, "temp_c": 38.9, "map_mmhg": 62}],
  "labs": {"lactate": 3.4, "wbc": 14.2}
}'
```

## Architecture

```
api/          request/response schemas + routes (X-Model-Track header)
registry/     MLflow loader (name+stage) + deterministic canary split
inference/    featurize (pure), sepsis LSTM, XGBoost, DenseNet121 + Grad-CAM, medspaCy
explain/      SHAP: DeepExplainer (LSTM, permutation fallback), TreeExplainer (XGB)
persistence/  append-only predictions table (hash-chained) + Kafka `predictions`
fallback/     documented deterministic rule-based cold-start scorers
```

### Canary routing
`CANARY_ENABLED=true` + `CANARY_MODEL_VERSION=<n>` routes a stable
`CANARY_PERCENT` share of patients to the canary version. Assignment is
`sha256(patient_id) % 100` — the same patient always gets the same track, and
the serving track is exposed in the `X-Model-Track` response header and the
predictions log.

### Cold-start mode
If the MLflow registry has no model for a name (fresh `make dev`), the
service serves deterministic rule-based scores instead of erroring:

- **sepsis** — NEWS2-inspired early-warning points over the latest vitals + lactate/WBC, normalized to [0, 1];
- **readmission** — LACE-flavoured heuristic (LOS, prior utilisation, comorbidity count, disposition, social support, age);
- **chest X-ray** — fixed ChestX-ray14 background prevalences (image not analysed);
- SHAP top-5 in this mode is a documented heuristic (deviation from population normals / feature magnitude).

All cold-start responses carry `model_version: "cold-start-rules-v1"` so they
can never be confused with model outputs downstream. **These rules are demo
plumbing, not clinical tools.**

### Predictions log
Every prediction appends a row
(`id, ts, model, model_version, patient_id_hash, input_hash, output_json, latency_ms, row_hash`)
to Postgres db `predictions` and emits the same event to Kafka topic
`predictions`. `row_hash` forms a tamper-evident chain
(`sha256(prev_hash || canonical_row)`), verifiable with
`persistence.hashing.verify_chain`. Log failures never fail a scoring request.

## BentoML packaging

`service.py` + `bentofile.yaml` package the identical engines as a Bento:

```bash
bentoml serve service:MedFlowService   # local
bentoml build -f bentofile.yaml        # build a Bento for Yatai/BentoCloud
```

## Development

```bash
pip install -e '.[dev]'
uvicorn medflow_serving.main:app --reload --port 8094
pytest                       # pure-logic unit tests, no services needed
ruff check src tests && black --check src tests && mypy src
```

Configuration: see `.env.example` (matches the `ml-serving` block in the
repo-level `docker-compose.yml`).
