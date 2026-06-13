# MedFlow Realtime Gateway (`@medflow/realtime-gateway`)

Socket.IO real-time gateway that fans Kafka events out to authenticated
clinician clients, with JWT auth, care-team room authorization, a Redis-backed
replay ring buffer, and OpenTelemetry tracing. **All data in this platform is
synthetic — no real PHI.**

## Purpose

Bridges the platform's Kafka event streams (vitals, alerts, clinical updates)
to browser/mobile clients over WebSockets. Clients join per-patient rooms only
when the JWT subject is on the patient's care team (verified against the
api-gateway). A Redis ring buffer lets reconnecting clients replay recently
missed events.

## Endpoints

| Transport | Path / Event | Description |
|---|---|---|
| WebSocket | Socket.IO (default namespace) | JWT handshake auth; join/leave patient rooms; receive fanned-out events |
| HTTP `GET` | `/healthz` | Liveness/readiness — 200 when Kafka + Redis reachable, 503 otherwise |
| HTTP `GET` | `/metrics` | Prometheus exposition |

Any other HTTP path returns 404 (Socket.IO owns the upgrade path).

## Environment

See `.env.example`.

| Var | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | `4001` | HTTP + WebSocket listen port |
| `KAFKA_BROKERS` | `kafka:9092` | Comma-separated bootstrap brokers |
| `API_GATEWAY_URL` | `http://api-gateway:4000` | Care-team membership lookups |
| `JWT_SIGNING_KEY` | — (required) | HS256 key for Socket.IO JWT verification |
| `REDIS_URL` | `redis://redis:6379` | Ring buffer / replay store |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP collector (optional) |
| `LOG_LEVEL` | `info` | pino level |
| `NODE_ENV` | `development` | `development` enables pretty logs |

## Run

```bash
cp .env.example .env
pnpm dev                         # tsx watch (hot reload)
pnpm build && node dist/main.js  # production

# Docker (multi-stage; dev + slim prod targets, non-root, healthcheck)
docker build --target dev   -t medflow-realtime-gateway:dev  .
docker build --target final -t medflow-realtime-gateway      .
```

In the compose dev overlay (`docker-compose.dev.yml`) the `dev` target is used
with `src/` bind-mounted for hot reload.

## Test

```bash
pnpm test   # vitest (room auth, etc.)
```
