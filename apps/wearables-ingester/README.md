# MedFlow Wearables Ingester (`medflow_wearables`)

Vitals ingestion for the MedFlow platform. Accepts wearable vitals over MQTT
(`vitals/{patient_id}`) and HTTP (`POST /v1/vitals`), validates physiologic
ranges, persists to Postgres with duplicate suppression, and fans accepted
readings out to Kafka `vitals.raw`. **All data in this platform is synthetic —
no real PHI.**

## Interfaces

| Interface | Detail |
|---|---|
| MQTT | subscribes `vitals/+` on `MQTT_BROKER:MQTT_PORT`; topic segment is authoritative for `patient_id` |
| HTTP | `POST /v1/vitals`, `GET /v1/vitals/{patient_id}?since=`, `GET /healthz`, `GET /metrics` on `HTTP_PORT` (8092) |
| Postgres | table `vitals`, unique `(patient_id, ts)`, index `ix_vitals_patient_ts` (alembic-managed) |
| Kafka | topic `vitals.raw`: `{patientId, ts, heartRate, spo2, respRate, tempC, systolicBp, diastolicBp}`, keyed by `patientId` |

## Validation (`schemas.VitalsReading`)

Wide "physiologically possible" bounds — reject sensor garbage, never a real
extreme reading: HR 20–300, SpO2 50–100, RR 4–60, temp 30–43 °C, SBP 50–260,
DBP 20–160. Timestamps more than 5 minutes in the future are rejected; naive
timestamps are interpreted as UTC. Invalid MQTT payloads are dropped and
counted (`vitals_rejected_total{source="mqtt"}`), never crash the consumer.

## Duplicate suppression

Two layers (see `db.py`): an in-process bounded LRU of `(patient_id, ts)` keys
(`DEDUP_CACHE_SIZE`, default 100k) plus `INSERT .. ON CONFLICT DO NOTHING` on
the `uq_vitals_patient_ts` constraint, so re-sent samples are idempotent even
across restarts/replicas. Duplicates are acknowledged (HTTP 202
`{"status": "duplicate"}`) but not re-published to Kafka.

## Layout

```
src/medflow_wearables/
  schemas.py         pydantic VitalsReading + range/timestamp validators
  db.py              async SQLAlchemy model, DedupCache, VitalsRepository
  mqtt.py            aiomqtt consumer loop + pure parse_message
  kafka_producer.py  confluent-kafka wrapper (run_in_executor, idempotent)
  api.py             FastAPI router (intake, query, healthz, metrics)
  main.py            app factory + lifespan wiring (db, mqtt task, kafka)
alembic/             migrations (0001 creates vitals table)
```

## Configuration (`.env.example`)

`HTTP_PORT`, `MQTT_BROKER`, `MQTT_PORT`, `DATABASE_URL`, `KAFKA_BROKERS`,
`OTEL_EXPORTER_OTLP_ENDPOINT` — all defaulted to the docker-compose values.

## Development

```bash
pip install -e ".[dev]"
pytest                 # schemas, dedup, MQTT parsing, API (fakes; no broker/db needed)
ruff check src tests && black --check src tests && mypy
alembic upgrade head   # apply migrations (uses DATABASE_URL)
```

Publish a test reading over MQTT:

```bash
mosquitto_pub -h localhost -t vitals/PAT-001 -m \
  '{"ts":"2026-06-01T12:00:00Z","heart_rate":72,"spo2":98,"resp_rate":16,"temp_c":36.8,"systolic_bp":120,"diastolic_bp":80}'
```
