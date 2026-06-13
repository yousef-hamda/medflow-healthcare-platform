# Load tests (k6)

Load-test scripts for the MedFlow stack. All data is synthetic.

## Prerequisites

- [k6](https://k6.io/docs/get-started/installation/) — `brew install k6`
- A running, seeded stack:

  ```bash
  make dev
  make seed-patients N=500
  ```

## Scripts

| Script    | Target                              | Profile                        |
| --------- | ----------------------------------- | ------------------------------ |
| `fhir.js` | FHIR server (`localhost:8090/fhir`) | Ramp 0→200 VUs over 3m, hold 3m |

`fhir.js` models clinician-dashboard read traffic: ~40% Patient searches
(name + recency paging), ~30% Patient reads by id (ids harvested in `setup()`),
~30% Observation queries (vitals LOINC codes, per-patient timelines).

## Running

```bash
k6 run scripts/load/fhir.js

# Against a different base URL:
k6 run -e FHIR_BASE=http://localhost:8090/fhir scripts/load/fhir.js

# Quick smoke (override the ramp):
k6 run --vus 10 --duration 30s scripts/load/fhir.js
```

## SLO thresholds (test fails if breached)

| Metric              | Threshold    |
| ------------------- | ------------ |
| `http_req_duration` | `p(95) < 500ms` |
| `http_req_failed`   | `rate < 1%`  |

Custom trends are emitted per operation (`fhir_patient_search_duration`,
`fhir_patient_read_duration`, `fhir_observation_duration`) so you can spot
which query class regresses.

## Tips

- Run twice; treat the first pass as a JVM/HAPI cache warm-up.
- Watch server-side latency in Grafana (http://localhost:3002) to separate
  network noise from FHIR server time.
- Keep load tests out of CI's default path — they are meant for local capacity
  checks and pre-release runs.
