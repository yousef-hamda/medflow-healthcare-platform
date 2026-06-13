# MedFlow FHIR Server

HAPI FHIR **R4 JPA server** embedded in Spring Boot 3.2.5 (Java 17). It is the canonical clinical
data store for the MedFlow platform and the source of truth that downstream services subscribe to.

> All data handled by this service is **synthetic**. No real PHI is processed, and logs never
> contain PHI values.

## Responsibilities

- Persist FHIR R4 resources in PostgreSQL via the HAPI JPA stack.
- Expose the FHIR REST API at `/fhir/*` for the supported resource types.
- Publish every create/update/delete as a JSON event to the Kafka `fhir.changes` topic.
- Serve the SMART-on-FHIR discovery document at `/.well-known/smart-configuration`.
- Asynchronously forward audit events to the audit service (graceful on failure).
- Export Prometheus metrics and health probes via Spring Boot Actuator.

## Supported resource types

`Patient`, `Encounter`, `Observation`, `Condition`, `MedicationRequest`, `DiagnosticReport`,
`ImagingStudy`, `DocumentReference`.

## Endpoints

| Endpoint | Description |
| --- | --- |
| `GET/POST/PUT/DELETE /fhir/*` | FHIR R4 REST API (HAPI `RestfulServer`). |
| `GET /fhir/metadata` | FHIR `CapabilityStatement`. |
| `GET /.well-known/smart-configuration` | SMART-on-FHIR discovery document. |
| `GET /actuator/health` | Liveness/readiness probes. |
| `GET /actuator/prometheus` | Prometheus metrics. |

## Kafka change events (`fhir.changes`)

Each resource mutation publishes a JSON envelope keyed by `resourceType/resourceId`:

```json
{
  "resourceType": "Patient",
  "resourceId": "123",
  "versionId": "2",
  "operation": "UPDATE",
  "timestamp": "2026-06-11T12:00:00Z",
  "resource": { "resourceType": "Patient", "id": "123", "...": "..." }
}
```

`operation` is one of `CREATE`, `UPDATE`, `DELETE`. Events are emitted from the HAPI
`STORAGE_PRECOMMIT_RESOURCE_CREATED/UPDATED/DELETED` pointcuts.

## Configuration

See [`.env.example`](./.env.example). Key variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `SERVER_PORT` | `8090` | HTTP listen port. |
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://postgres:5432/fhir` | PostgreSQL JDBC URL. |
| `SPRING_DATASOURCE_USERNAME` / `_PASSWORD` | `medflow` / `medflow_dev_password` | DB credentials. |
| `KAFKA_BROKERS` | `kafka:9092` | Kafka bootstrap servers. |
| `AUDIT_SERVICE_URL` | `http://audit-service:8095` | Audit service base URL. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTLP/HTTP collector. |

## PHI-safe logging

Logging uses `logstash-logback-encoder` (JSON). Application code references resources only by
**type and id** — names, MRN, DOB, phone and address are never logged. See
`src/main/resources/logback-spring.xml`.

## Build & run

```bash
# Build (requires JDK 17 + Maven)
mvn clean package

# Run locally
java -jar target/fhir-server.jar

# Container build (multi-stage)
docker build -t medflow/fhir-server .
```

Within the platform the service is started by `docker compose up fhir-server`.

## Tests

JUnit 5 + Mockito:

- `KafkaResourceChangeInterceptorTest` — verifies the change-event envelope mapping with a mocked
  `KafkaTemplate`.
- `SmartConfigurationControllerTest` — verifies the discovery document payload via `MockMvc`.
- `AuditEventInterceptorTest` — verifies graceful degradation when the audit service is unavailable.

```bash
mvn test
```
