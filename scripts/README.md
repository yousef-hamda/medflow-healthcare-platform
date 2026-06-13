# `scripts/` — MedFlow operational scripts

Helper scripts for seeding synthetic data, driving simulators, running
compliance/security checks, and the pre-commit guards. **All data is
synthetic** (Synthea-style); no real PHI is ever used.

Most scripts have a matching `make` target — prefer the target so you get the
documented defaults and environment wiring.

## Index

| Script | Purpose | Usage | `make` target |
| --- | --- | --- | --- |
| `seed_patients.sh` | Generate N Synthea patients and load them into the FHIR server (`:8090`), archiving raw bundles in MinIO. | `./scripts/seed_patients.sh [N]` (default 500) | `make seed-patients N=500` |
| `simulators/hl7_replay.py` | Replay HL7v2 ADT/ORU/ORM messages over MLLP to the hl7v2-ingester; parses ACKs (AA/AE/AR). Stdlib only. | `python3 scripts/simulators/hl7_replay.py --host localhost --port 2575 --file scripts/simulators/data/hl7_messages.csv --rate 5` | `make sim-hl7 [RATE=5]` |
| `simulators/dicom_push.py` | C-ECHO then C-STORE synthetic 224×224 chest-X-ray-like Secondary Capture DICOMs to the dicom-receiver. | `python3 scripts/simulators/dicom_push.py --host localhost --port 11112 [--count 10]` | `make sim-dicom` |
| `simulators/vitals_stream.py` | Stream synthetic wearable vitals for 10 patients over MQTT (HTTP fallback); 2 patients trend toward sepsis to trip Flink alerts. | `python3 scripts/simulators/vitals_stream.py --broker localhost --port 1883` | `make sim-vitals` |
| `simulators/data/hl7_messages.csv` | Synthetic HL7v2.5 replay deck consumed by `hl7_replay.py` (segment CRs escaped as literal `\r`). | data file — not executed directly | (used by `make sim-hl7`) |
| `download_chestxray.sh` | Fetch a small NIH ChestX-ray14 slice into `ml/data/chestxray14/` for local fine-tuning. **Research-use-only license; never committed.** | `./scripts/download_chestxray.sh [archive_count]` (default 1) | `make download-chestxray` |
| `compliance_report.sh` | Generate the compliance posture report (encryption, audit hash-chain, scan status) as Markdown to stdout and `.volumes/`. | `./scripts/compliance_report.sh` | `make compliance-report` |
| `audit_query.sh` | Run the example audit-review queries (`compliance/audit-queries/*.sql`) against the `audit` DB (psql or `docker compose exec`). | `./scripts/audit_query.sh` | `make audit-query` |
| `scan.sh` | Trivy-scan every local `medflow-*` image; fail on HIGH/CRITICAL (mirrors the CI security gate). | `./scripts/scan.sh` | `make scan` |
| `sbom.sh` | Generate SPDX SBOMs (Syft) for every `medflow-*` image into `sbom/` and scan them with Grype. | `./scripts/sbom.sh` | `make sbom` |
| `submit_flink_job.sh` | Submit the PyFlink sepsis-alerting job to the local Flink cluster (with pre-flight health checks). | `./scripts/submit_flink_job.sh` | `make flink` (after bringing up Flink) |
| `test_python.sh` | Run `pytest` for every Python service (`PYTHONPATH=src`) and print a pass/skip/fail summary table. | `./scripts/test_python.sh [extra pytest args...]` | `make test` (Python half) |
| `load/fhir.js` | k6 load test for the FHIR server: mixed read workload (~40% search / ~30% read / ~30% observation), ramp to 200 VUs, SLOs p95<500ms & err<1%. | `k6 run scripts/load/fhir.js` (or `-e FHIR_BASE=...`) | none (manual capacity check; see `scripts/load/README.md`) |
| `hooks/check_phi_logging.py` | Pre-commit guard: flag PHI-looking identifiers/keys passed to log calls. Python = AST mode; TS/JS = regex mode. Suppress with `# phi-ok: <reason>`. | `python3 scripts/hooks/check_phi_logging.py FILE...` or `--mode ts src/**/*.ts` | invoked by `.husky/pre-commit` and `.pre-commit-config.yaml` |

## Notes

- The simulators are stdlib-first: HL7 replay needs nothing extra; DICOM push
  needs `pydicom`+`pynetdicom` (already in the dicom-receiver env); vitals
  stream prefers `paho-mqtt` but falls back to HTTP.
- `scan.sh` / `sbom.sh` mirror the `security` job in
  `.github/workflows/ci.yml` so local results match CI gating.
- `hooks/check_phi_logging.py` is the single source for both the husky
  `pre-commit` hook and the two `check-phi-logging` / `check-phi-logging-ts`
  local hooks in `.pre-commit-config.yaml`.
