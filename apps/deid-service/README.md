# MedFlow De-Identification Service (`medflow_deid`)

HIPAA **Safe Harbor** de-identification for free-text clinical notes and FHIR
resources. Combines [Presidio](https://microsoft.github.io/presidio/) NLP with
custom regex recognizers and a structural FHIR walker, behind a small FastAPI
service. **All data in this platform is synthetic — no real PHI.**

## Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/v1/deid/text` | `{text, patient_id}` → `{text, entities_removed}` (types only, never values) |
| `POST` | `/v1/deid/fhir` | `{resource}` → `{resource, entities_removed}` — de-identified deep copy (`Patient`, `Observation`, `DocumentReference`) |
| `GET` | `/healthz` | Liveness + active mode (`presidio_active`) |
| `GET` | `/metrics` | Prometheus exposition |

Every `/v1/deid/*` call emits a fire-and-forget audit event (see below).
`entities_removed` returns only entity **types** (`["PHONE_NUMBER", "MRN"]`),
so the response itself never carries PHI.

## Run

```bash
cp .env.example .env
uvicorn medflow_deid.main:app --host 0.0.0.0 --port 8093   # or: python -m medflow_deid.main
docker build -t medflow-deid-service .                     # multi-stage, runs as non-root
```

## Test

```bash
pip install -e ".[dev]"
pytest          # date-shift determinism, ZIP3 restricted prefixes, FHIR walker,
                # analyzer regexes, API (httpx AsyncClient, mocked audit), PHI-safe logging
```

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `HTTP_PORT` | `8093` | HTTP listen port |
| `AUDIT_SERVICE_URL` | `http://audit-service:8095` | Audit base URL; `/v1/events` is appended |
| `AUDIT_QUEUE_SIZE` | `1000` | Bounded audit retry queue depth |
| `AUDIT_RETRY_ATTEMPTS` | `3` | Per-event delivery attempts (exponential backoff) |
| `DATE_SHIFT_SECRET` | dev only | HMAC key for date shift + pseudonyms |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | OTLP/HTTP collector |
| `LOG_LEVEL` | `INFO` | structlog level |

## Safe Harbor mapping

The service implements the 18 HIPAA Safe Harbor identifier classes
(45 CFR §164.514(b)(2)) as follows:

| Identifier (Safe Harbor) | Handling |
|---|---|
| Names | FHIR `name`/`contact` removed; `display` on references removed; PERSON spans replaced in text (Presidio mode) |
| Geographic < state | `address` reduced to `state` (+ `country`); street/city/district/text dropped |
| ZIP code | Truncated to first 3 digits; the 17 restricted prefixes (036, 059, 063, 102, 203, 556, 692, 790, 821, 823, 830, 831, 878, 879, 884, 890, 893) → `000` |
| All dates < year; ages ≥ 89 | FHIR `birthDate` → year; **age ≥ 90 aggregated to a single floor year (`1930`)**; all other dates **shifted** (see below) |
| Telephone / fax | `telecom` removed; US (NANP) + Israeli phone regexes in text |
| Email | `telecom` removed; email regex in text |
| SSN | `US_SSN` regex |
| MRN / account / other IDs | `identifier` → keyed pseudonym under `urn:medflow:pseudonym`; resource `id` and `reference` ids pseudonymised; `MRN:` regex in text |
| Device IDs, URLs, IPs, biometric, photos | `photo` removed; URL/IP via Presidio; free-text URLs/IPs |
| Any other unique identifier | `FHIR_REFERENCE` regex in narrative; literal references pseudonymised |

Narrative `text.div` and free-text fields (`description`, `title`, `comment`,
`note`) are passed through the text engine.

### Degraded (regex-only) mode

Presidio + its spaCy model are heavy. If `presidio_analyzer` is not importable
the service transparently falls back to the custom regex recognizers (MRN,
phone, email, SSN, FHIR reference). NLP-based detection (PERSON, LOCATION,
free-form dates) is then **not** available — this is documented residual risk.
The active mode is exported via the `deid_presidio_enabled` gauge and
`/healthz`.

## Date-shift HMAC design

Safe Harbor forbids dates more specific than the year, but research needs
*temporal relationships*. The standard compromise is a **consistent per-patient
shift**:

```
offset_days = sign · ((HMAC-SHA256(DATE_SHIFT_SECRET, patient_id)[:8] mod 365) + 1)   # ±[1,365], never 0
```

- **Deterministic** — re-processing a patient on any replica, any day, yields
  identical shifted dates, so joins across de-identified datasets keep working.
- **Interval-preserving** — the *same* offset applies to *every* date for that
  patient, so admit→discharge gaps, dosing intervals and trend curves survive
  exactly. Different patients get independent offsets, destroying cross-patient
  calendar alignment.
- **Keyed** — HMAC (not a bare hash) prevents recovering the offset by
  brute-forcing `patient_id`; without the secret the offset is unrecoverable
  from the output.
- **Bounded** — `|offset| ≤ 365` keeps the treatment era roughly truthful while
  breaking linkage to real calendar dates. Precision is preserved (`YYYY`,
  `YYYY-MM`, `YYYY-MM-DD`, datetime with time-of-day/offset kept).

Identifier pseudonyms use the same secret under a separate HMAC domain
(`medflow-pseudonym:`), so id linkage survives longitudinally without exposing
the date offset.

## Audit trail

Each call enqueues an `AuditEvent`
(`{actorId: "deid-service", actorRole: "service", action, resourceType,
resourceId, justification}`) onto a **bounded** `asyncio.Queue`; a background
worker POSTs it to `{AUDIT_SERVICE_URL}/v1/events` with bounded retries and
backoff. This is strictly **off the request path**: a full queue drops the
event (counted via `deid_audit_events_total{outcome="dropped"}`), and every
delivery failure degrades silently. De-identification never blocks on, or fails
because of, the audit service.

## Residual risk

- **Regex-only fallback** misses names/locations/free-form dates with no
  trigger token; deploy with Presidio enabled for production de-id.
- **Date shift is reversible with the secret** — `DATE_SHIFT_SECRET` is the
  re-identification key and must be protected like one; rotating it breaks
  longitudinal linkage.
- **Bounded ±365-day shift** preserves the treatment era, so coarse temporal
  inference (season, year of care) remains possible by design.
- **Pseudonyms are deterministic** — identical inputs map to identical outputs,
  enabling linkage attacks against an adversary who can submit chosen ids;
  acceptable for the intended internal research linkage use-case.
- **Free-text is best-effort** — Safe Harbor on unstructured narrative is never
  provably complete; outputs should be treated as de-identified, not anonymous,
  and access-controlled accordingly.
- **Dropped audit events** under sustained audit-service outage mean the audit
  log is not guaranteed complete; this is a deliberate availability trade-off
  for the PHI request path.
