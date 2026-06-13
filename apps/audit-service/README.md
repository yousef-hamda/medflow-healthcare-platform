# MedFlow Audit Service (`@medflow/audit-service`)

Append-only, **hash-chained** HIPAA audit log. Ingests `AuditEvent`s over HTTP
and from Kafka, writes them through a single FIFO queue so the SHA-256 hash
chain is never built concurrently, verifies chain integrity on demand, and
exports daily WORM archives to MinIO/S3 with object-lock retention. **All data
in this platform is synthetic — no real PHI.**

## Purpose

Provides a tamper-evident system of record for security/compliance events
(access, break-glass, de-identification, etc.). Each row's hash covers the
previous row's hash, so any retroactive edit or deletion breaks the chain and
is detectable via `/v1/verify`. The `audit_log` table is append-only —
UPDATE/DELETE/TRUNCATE are blocked by DB triggers
(`infra/docker/postgres/init-audit.sql`).

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/events` | Ingest a single `AuditEvent` or an array; returns `{ accepted }` (202) |
| `GET` | `/v1/events` | Paginated, filtered query (`actor`, `action`, `resourceType`, `resourceId`, `from`, `to`, `breakGlassOnly`, `afterId`, `limit`) |
| `GET` | `/v1/verify` | Streams the full chain and reports integrity |
| `POST` | `/v1/export/daily` | `{date: YYYY-MM-DD}` → gzipped JSONL WORM export to MinIO |
| `GET` | `/healthz` | Liveness/readiness (db + kafka) |
| `GET` | `/metrics` | Prometheus exposition |

`justification` may carry sensitive context and is redacted in logs by pino.

## Environment

See `.env.example`.

| Var | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | `8095` | HTTP listen port |
| `DATABASE_URL` | — | Postgres connection (append-only `audit_log`) |
| `KAFKA_BROKERS` | `kafka:9092` | Brokers for the `audit.events` consumer |
| `WORM_BUCKET` | `audit-worm` | Object-lock bucket for daily exports |
| `MINIO_ENDPOINT` | `http://minio:9000` | S3/MinIO endpoint |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | — | S3/MinIO credentials |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP collector (optional) |
| `LOG_LEVEL` | `info` | pino level |

## Run

```bash
cp .env.example .env
pnpm dev                         # tsx watch (hot reload)
pnpm build && node dist/main.js  # production

# Docker (multi-stage; dev + slim prod targets, non-root, healthcheck)
docker build --target dev   -t medflow-audit-service:dev  .
docker build --target final -t medflow-audit-service      .
```

Startup loads the last hash from the DB so the chain continues across restarts;
the HTTP and Kafka ingest paths share one FIFO write queue.

## Test

```bash
pnpm test   # vitest
```
