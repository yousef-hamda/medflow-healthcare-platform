# MedFlow HL7v2 Ingester

An **MLLP listener** (Spring Boot 3.2.5, Java 17) that accepts HL7 v2.5 messages, maps them to
FHIR R4 resources, persists them in the MedFlow FHIR server via identifier-based conditional create,
and mirrors every raw message onto the Kafka `hl7.raw` topic.

> All processed data is **synthetic**. No real PHI is handled, and logs reference messages only by
> type and control id.

## Pipeline

```
MLLP (port 2575)
   └─ SimpleServer / ReceivingApplication
        ├─ PipeParser  ──► HAPI message model
        ├─ Mappers     ──► FHIR R4 resources
        ├─ FhirResourceWriter (conditional create on identifier) ──► FHIR server
        ├─ RawMessagePublisher ──► Kafka topic hl7.raw
        └─ ACK (AA) / NAK (AE)
```

## Supported messages

| Message | Trigger(s) | FHIR output |
| --- | --- | --- |
| `ADT` | `A01`, `A02`, `A03`, `A08` | `Patient` (PID), `Encounter` (PV1) |
| `ORU` | `R01` | `Observation` per OBX (LOINC), `DiagnosticReport` per OBR |
| `ORM` | `O01` | `ServiceRequest` per ORC/OBR order |

Successful processing returns an application **ACK (AA)**; any failure returns a **NAK (AE)** and
the message is routed to the dead-letter path (control id logged only).

## Field mapping

### ADT — PID → Patient

| HL7v2 field | FHIR element |
| --- | --- |
| PID-3 Patient Identifier List | `Patient.identifier` (system `urn:medflow:mrn`) |
| PID-5 Patient Name (XPN) | `Patient.name` (family / given) |
| PID-7 Date/Time of Birth | `Patient.birthDate` |
| PID-8 Administrative Sex | `Patient.gender` (M/F/O → male/female/other) |
| PID-11 Patient Address (XAD) | `Patient.address` (line / city / state / postalCode) |

### ADT — PV1 → Encounter

| HL7v2 field | FHIR element |
| --- | --- |
| PV1-19 Visit Number | `Encounter.identifier` (system `urn:medflow:visit-number`) |
| MSH-9 Trigger Event | `Encounter.status` (A01→in-progress, A03→finished, …) |
| PV1-2 Patient Class | `Encounter.class` (I→IMP, E→EMER, O→AMB) |

### ORU — OBR → DiagnosticReport, OBX → Observation

| HL7v2 field | FHIR element |
| --- | --- |
| OBR-3 Filler Order Number | `DiagnosticReport.identifier` (`urn:medflow:filler-order-number`) |
| OBR-4 Universal Service Identifier | `DiagnosticReport.code` |
| OBX-3 Observation Identifier | `Observation.code` (LOINC when coding system = `LN`/`LOINC`) |
| OBX-2/OBX-5 Value Type & Value | `Observation.valueQuantity` (numeric) or `valueString` |
| OBX-6 Units | `Observation.valueQuantity.unit` (UCUM) |
| OBX-11 Result Status | `Observation.status` (F→final, P→preliminary, C→corrected) |

### ORM — ORC/OBR → ServiceRequest

| HL7v2 field | FHIR element |
| --- | --- |
| ORC-2 Placer Order Number | `ServiceRequest.identifier` (`urn:medflow:placer-order-number`) |
| ORC-1 Order Control | `ServiceRequest.status` (NW→active, CA→revoked, CM→completed, HD→on-hold) |
| OBR-4 Universal Service Identifier | `ServiceRequest.code` |

## Kafka raw mirror (`hl7.raw`)

```json
{
  "messageType": "ADT^A01",
  "controlId": "MSG00001",
  "receivedAt": "2026-06-11T12:00:00Z",
  "raw": "MSH|^~\\&|...",
  "status": "PROCESSED"
}
```

`status` is one of `RECEIVED`, `PROCESSED`, `PARSE_ERROR`.

## Configuration

See [`.env.example`](./.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `MLLP_PORT` | `2575` | MLLP listen port. |
| `SERVER_PORT` | `8097` | HTTP/actuator port. |
| `FHIR_BASE_URL` | `http://fhir-server:8090/fhir` | Target FHIR server. |
| `KAFKA_BROKERS` | `kafka:9092` | Kafka bootstrap servers. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTLP/HTTP collector. |

## PHI-safe logging

JSON logging via `logstash-logback-encoder`. Application code logs only message type and control id;
segment values and full raw messages are never written to logs. See
`src/main/resources/logback-spring.xml`.

## Build & run

```bash
mvn clean package
java -jar target/hl7v2-ingester.jar
docker build -t medflow/hl7v2-ingester .
```

## Tests

JUnit 5 + Mockito with synthetic v2.5 messages (`TestMessages`, names like `SYNTHEA^TEST`):

- `AdtToFhirMapperTest` — PID→Patient, PV1→Encounter mapping.
- `OruToFhirMapperTest` — OBX→Observation (LOINC) and DiagnosticReport per OBR.
- `OrmToFhirMapperTest` — ORC/OBR→ServiceRequest mapping.
- `AcknowledgementTest` — ACK (AA) / NAK (AE) generation.
- `MllpRoundTripTest` — SimpleServer on a random port + HAPI client round-trip.

```bash
mvn test
```
