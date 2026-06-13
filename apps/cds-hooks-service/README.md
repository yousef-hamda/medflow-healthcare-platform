# MedFlow CDS Hooks Service (`@medflow/cds-hooks-service`)

[CDS Hooks 1.1](https://cds-hooks.org) decision-support service providing two
clinical hooks — **sepsis early-warning** and **30-day readmission risk** —
backed by the MedFlow ML serving models and FHIR prefetch. **All data in this
platform is synthetic — no real PHI.**

## Purpose

EHRs invoke this service at clinical decision points. It validates the CDS
Hooks request, assembles a recent vitals window (from `prefetch` when present,
otherwise by querying the FHIR server), calls the ML model, and returns CDS
cards with a risk indicator, SHAP-based explanations, and actionable order
suggestions. Upstream (FHIR/ML) failures degrade to an empty `{ cards: [] }`
with HTTP 200 so a clinician's workflow is never blocked.

## Endpoints

| Method | Path | Hook | Description |
|---|---|---|---|
| `GET` | `/cds-services` | — | CDS Hooks discovery document |
| `POST` | `/cds-services/sepsis-warning` | `patient-view` | Sepsis risk card(s) |
| `POST` | `/cds-services/readmission-risk` | `encounter-discharge` | Readmission risk card(s) |
| `POST` | `/cds-services/:id/feedback` | — | Persist accepted/overridden feedback |
| `GET` | `/healthz` | — | Liveness |
| `GET` | `/metrics` | — | Prometheus exposition |

CDS Hooks payloads (`context`, `prefetch`, request body) are redacted in logs by
pino.

## Environment

See `.env.example`.

| Var | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | `8096` | HTTP listen port |
| `ML_SERVING_URL` | `http://ml-serving:8094` | ML `/predict/sepsis` and `/predict/readmission` |
| `FHIR_BASE_URL` | `http://fhir-server:8090/fhir` | FHIR R4 base (prefetch fallback) |
| `DATABASE_URL` | — (required) | Postgres for `cds_feedback` |
| `UPSTREAM_TIMEOUT_MS` | `5000` | FHIR/ML fetch timeout |
| `MODEL_CARD_BASE_URL` | `https://medflow.internal/model-cards` | Card link base |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP collector (optional) |
| `LOG_LEVEL` | `info` | pino level |
| `NODE_ENV` | `development` | `development` enables pretty logs |

## Run

```bash
cp .env.example .env
pnpm dev                          # tsx watch (hot reload)
pnpm build && pnpm start          # production (node dist/index.js)

# Docker (multi-stage; dev + slim prod targets, non-root, healthcheck)
docker build --target dev   -t medflow-cds-hooks-service:dev  .
docker build --target final -t medflow-cds-hooks-service      .
```

On startup the service ensures the `cds_feedback` table exists (best-effort;
logged and skipped if Postgres is briefly unreachable).

## Test

```bash
pnpm test   # vitest
```
