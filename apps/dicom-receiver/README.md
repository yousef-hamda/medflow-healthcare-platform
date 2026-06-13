# MedFlow DICOM Receiver (`medflow_dicom`)

DICOM SCP + ingestion pipeline for the MedFlow platform. Receives imaging from
modalities over DIMSE, persists it to MinIO, registers a FHIR `ImagingStudy`,
emits a Kafka event, and produces ML-ready 224x224 PNG previews plus a Parquet
manifest. **All data in this platform is synthetic — no real PHI.**

## Interfaces

| Interface | Detail |
|---|---|
| DICOM SCP | AE title `MEDFLOW`, port `11112`; C-ECHO + C-STORE |
| SOP classes | CT Image Storage, Computed Radiography, Digital X-Ray (presentation + processing), Secondary Capture |
| Transfer syntaxes | Explicit / Implicit VR Little Endian (uncompressed; previews require natively decodable pixel data) |
| HTTP | `GET /healthz`, `GET /metrics` (Prometheus) on `HTTP_PORT` (8091) |
| MinIO | `imaging/{patient_id}/{study_uid}/{instance_uid}.dcm` and `...{instance_uid}.preview.png` |
| FHIR | conditional create of `ImagingStudy` on `urn:dicom:uid|urn:oid:{StudyInstanceUID}` |
| Kafka | topic `dicom.received`: `{patientId, studyUid, seriesUid, instanceUid, modality, s3Key, receivedAt}` |
| Manifest | `manifests/imaging.parquet` (pyarrow, zstd) — one row per received instance |

## C-STORE flow

1. **Persist first.** The original DICOM file is written to MinIO before
   anything else; a storage failure is the only thing that fails the C-STORE
   (status `0xA700`). Everything downstream is best-effort and surfaced via
   `dicom_store_failures_total{stage=...}`.
2. **Metadata extraction** is pseudonymised by construction: only `PatientID`,
   UIDs, `Modality`, `BodyPartExamined` and `StudyDate` are read.
   `PatientName` is never extracted, logged, or forwarded. The structlog
   pipeline additionally redacts any PHI-shaped log keys (`medflow_dicom.logging.redact_phi`).
3. **FHIR**: `POST /ImagingStudy` with `If-None-Exist:
   identifier=urn:dicom:uid|urn:oid:{study_uid}` so re-sent instances of the
   same study never create duplicates.
4. **Kafka**: idempotent producer, keyed by `patientId` so per-patient ordering
   is preserved.
5. **Pipeline**: pixel data is min-max normalised, MONOCHROME1 inverted,
   resized to 224x224 greyscale PNG, stored alongside the `.dcm`; one manifest
   row is appended.

## Manifest concurrency (read-modify-write + ETag note)

`manifests/imaging.parquet` is updated read-modify-write: download, append a
row with pyarrow, re-upload. Within a single replica a process-level lock
serialises writers, which is sufficient for the compose deployment (one
receiver). **If you scale to multiple replicas**, the read-modify-write cycle
becomes a lost-update race. The intended fix is an ETag compare-and-swap:
remember the ETag returned by `GET`, then upload with
`If-Match: <etag>` (S3 conditional write) and retry the whole
read-modify-write cycle on `412 Precondition Failed`. MinIO supports
conditional writes since RELEASE.2024-xx; alternatively move the manifest to a
proper table format (Delta/Iceberg) which is the long-term plan for the
lakehouse layer.

## Layout

```
src/medflow_dicom/
  scp/        pynetdicom AE + C-ECHO/C-STORE handlers (pure logic in process_instance)
  storage/    MinIO client + path sanitisation (traversal-proof object keys)
  fhir/       ImagingStudy builder + conditional-create client
  pipeline/   preview rendering (numpy/Pillow) + Parquet manifest writer
  events/     confluent-kafka producer for dicom.received
  app.py      FastAPI: /healthz, /metrics
  main.py     entrypoint: SCP threads + uvicorn in one process
```

## Configuration (`.env.example`)

`DICOM_AE_TITLE`, `DICOM_PORT`, `HTTP_PORT`, `MINIO_ENDPOINT`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `FHIR_BASE_URL`, `KAFKA_BROKERS` —
all defaulted to the docker-compose values.

## Development

```bash
pip install -e ".[dev]"
pytest                 # unit tests: handlers, mapping, sanitisation, manifest, preprocessing
ruff check src tests && black --check src tests && mypy
```

Send a test image with pynetdicom's `storescu`:

```bash
python -m pynetdicom storescu localhost 11112 image.dcm -aet TEST -aec MEDFLOW
```
