// fhir.js — k6 load test for the MedFlow FHIR server.
//
// Run:   k6 run scripts/load/fhir.js
//        k6 run -e FHIR_BASE=http://localhost:8090/fhir scripts/load/fhir.js
//
// Mixed read workload modelled on clinician-dashboard traffic:
//   ~40% Patient searches, ~30% Patient reads, ~30% Observation queries.
// Ramps to 200 VUs; SLOs: p(95) latency < 500ms, error rate < 1%.
//
// All data is synthetic (seed first: make seed-patients N=500).

import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const FHIR_BASE = __ENV.FHIR_BASE || "http://localhost:8090/fhir";

const patientSearchDuration = new Trend("fhir_patient_search_duration", true);
const patientReadDuration = new Trend("fhir_patient_read_duration", true);
const observationDuration = new Trend("fhir_observation_duration", true);

export const options = {
  scenarios: {
    mixed_fhir_reads: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "1m", target: 50 }, // warm-up
        { duration: "2m", target: 200 }, // ramp to peak
        { duration: "3m", target: 200 }, // hold at peak
        { duration: "1m", target: 0 }, // ramp down
      ],
      gracefulRampDown: "30s",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500"],
    http_req_failed: ["rate<0.01"],
  },
};

const PARAMS = { headers: { Accept: "application/fhir+json" } };
const FAMILY_NAMES = ["smith", "jones", "garcia", "chen", "miller", "patel"];
const VITAL_CODES = [
  "8867-4", // heart rate
  "2708-6", // SpO2
  "9279-1", // respiratory rate
  "8310-5", // body temperature
  "85354-9", // blood pressure panel
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// setup() collects a pool of real Patient ids so the read path exercises
// GET /Patient/{id} with 200s instead of synthetic-id 404s.
export function setup() {
  const res = http.get(`${FHIR_BASE}/Patient?_count=50&_elements=id`, PARAMS);
  const ids = [];
  try {
    for (const entry of res.json("entry") || []) {
      if (entry.resource && entry.resource.id) ids.push(entry.resource.id);
    }
  } catch (_) {
    /* server empty — reads will fall back to searches */
  }
  if (ids.length === 0) {
    console.warn("No patients found — run `make seed-patients` first for realistic reads.");
  }
  return { ids };
}

export default function (data) {
  const dice = Math.random();

  if (dice < 0.4) {
    // ── Patient search (name / paging) ──────────────────────────────────────
    const q =
      Math.random() < 0.5
        ? `${FHIR_BASE}/Patient?name=${pick(FAMILY_NAMES)}&_count=20`
        : `${FHIR_BASE}/Patient?_count=20&_sort=-_lastUpdated`;
    const res = http.get(q, PARAMS);
    patientSearchDuration.add(res.timings.duration);
    check(res, {
      "patient search 200": (r) => r.status === 200,
      "patient search is Bundle": (r) => (r.json("resourceType") || "") === "Bundle",
    });
  } else if (dice < 0.7 && data.ids.length > 0) {
    // ── Patient read ─────────────────────────────────────────────────────────
    const res = http.get(`${FHIR_BASE}/Patient/${pick(data.ids)}`, PARAMS);
    patientReadDuration.add(res.timings.duration);
    check(res, { "patient read 200": (r) => r.status === 200 });
  } else {
    // ── Observation queries (vitals by LOINC code, optionally per patient) ──
    const code = pick(VITAL_CODES);
    const q =
      data.ids.length > 0 && Math.random() < 0.5
        ? `${FHIR_BASE}/Observation?patient=${pick(data.ids)}&_count=20&_sort=-date`
        : `${FHIR_BASE}/Observation?code=${code}&_count=20`;
    const res = http.get(q, PARAMS);
    observationDuration.add(res.timings.duration);
    check(res, {
      "observation query 200": (r) => r.status === 200,
      "observation query is Bundle": (r) => (r.json("resourceType") || "") === "Bundle",
    });
  }

  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s think time
}
