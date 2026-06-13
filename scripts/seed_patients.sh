#!/usr/bin/env bash
# seed_patients.sh — Generate N synthetic patients with Synthea and load them
# into the MedFlow FHIR server, then archive the raw bundles in MinIO.
#
# Usage:   ./scripts/seed_patients.sh [N]        (default N=500)
# Re-run safe: Synthea output is regenerated, FHIR POSTs are transaction
# bundles so duplicates create new resources (clean with `make clean`).
#
# Approach for Synthea: the official synthetichealth/synthea image is the
# cleanest documented path — no local Java required:
#   docker run --rm -v $PWD/.volumes/synthea:/output synthetichealth/synthea:latest \
#     -p N --exporter.fhir.export true
# (Alternative considered: intersystemsdc/irisdemo-base-synthea:version-1.3.4,
#  or building an openjdk image that downloads the synthea-with-dependencies
#  jar. Rejected: extra moving parts for the same output.)
#
# All data is synthetic. No real PHI is ever used.

set -euo pipefail

N="${1:-500}"
FHIR_BASE="${FHIR_BASE:-http://localhost:8090/fhir}"
MINIO_ENDPOINT="${MINIO_ENDPOINT:-http://localhost:9000}"
MINIO_ACCESS_KEY="${MINIO_ACCESS_KEY:-minio_admin}"
MINIO_SECRET_KEY="${MINIO_SECRET_KEY:-minio_dev_password}"
MINIO_BUCKET="${MINIO_BUCKET:-synthea-raw}"
SYNTHEA_IMAGE="${SYNTHEA_IMAGE:-synthetichealth/synthea:latest}"
OUT_DIR="$PWD/.volumes/synthea"
FHIR_DIR="$OUT_DIR/fhir"
MAX_RETRIES=5

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

command -v docker >/dev/null 2>&1 || { err "docker is required"; exit 1; }
command -v curl   >/dev/null 2>&1 || { err "curl is required"; exit 1; }

# ── 1. Generate patients with Synthea ────────────────────────────────────────
bold "==> [1/4] Generating ${N} synthetic patients with Synthea (${SYNTHEA_IMAGE})"
mkdir -p "$OUT_DIR"

docker run --rm \
  -v "$OUT_DIR:/output" \
  "$SYNTHEA_IMAGE" \
  -p "$N" \
  --exporter.fhir.export true \
  --exporter.fhir.transaction_bundle true \
  --exporter.hospital.fhir.export true \
  --exporter.practitioner.fhir.export true

if [ ! -d "$FHIR_DIR" ] || ! ls "$FHIR_DIR"/*.json >/dev/null 2>&1; then
  err "Synthea produced no FHIR bundles in $FHIR_DIR — aborting."
  exit 1
fi

# ── 2. Wait for the FHIR server, then POST transaction bundles ───────────────
bold "==> [2/4] Loading bundles into FHIR server at ${FHIR_BASE}"

for i in $(seq 1 30); do
  if curl -sf -o /dev/null "${FHIR_BASE}/metadata"; then break; fi
  if [ "$i" -eq 30 ]; then err "FHIR server not reachable at ${FHIR_BASE}"; exit 1; fi
  echo "    waiting for FHIR server (${i}/30)..."
  sleep 5
done

post_bundle() {
  # POST a transaction bundle with retry + exponential backoff.
  local file="$1" attempt=1 http_code
  while [ "$attempt" -le "$MAX_RETRIES" ]; do
    http_code=$(curl -s -o /dev/null -w '%{http_code}' \
      -X POST "${FHIR_BASE}" \
      -H 'Content-Type: application/fhir+json' \
      --data-binary "@${file}") || http_code=000
    case "$http_code" in
      200|201) return 0 ;;
      *)
        sleep $((attempt * 2))
        attempt=$((attempt + 1))
        ;;
    esac
  done
  return 1
}

# Hospital and practitioner bundles first so patient bundles can reference them.
ordered_files=$(
  { ls "$FHIR_DIR"/hospitalInformation*.json 2>/dev/null || true
    ls "$FHIR_DIR"/practitionerInformation*.json 2>/dev/null || true
    ls "$FHIR_DIR"/*.json | grep -v -e hospitalInformation -e practitionerInformation
  }
)

total=$(echo "$ordered_files" | grep -c . || true)
loaded=0
failed=0
for f in $ordered_files; do
  if post_bundle "$f"; then
    loaded=$((loaded + 1))
  else
    failed=$((failed + 1))
    err "    FAILED after ${MAX_RETRIES} attempts: $(basename "$f")"
  fi
  if [ $(( (loaded + failed) % 25 )) -eq 0 ] || [ $((loaded + failed)) -eq "$total" ]; then
    printf '    progress: %d/%d bundles (%d failed)\n' "$((loaded + failed))" "$total" "$failed"
  fi
done
bold "    Loaded ${loaded}/${total} bundles into FHIR (${failed} failed)."

# ── 3. Archive raw bundles to MinIO (bucket: synthea-raw) ────────────────────
bold "==> [3/4] Uploading raw bundles to MinIO bucket '${MINIO_BUCKET}'"

upload_with_mc() {
  local mc_cmd=("$@")
  "${mc_cmd[@]}" alias set medflow "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  "${mc_cmd[@]}" mb --ignore-existing "medflow/${MINIO_BUCKET}" >/dev/null
  "${mc_cmd[@]}" cp --recursive "$FHIR_DIR/" "medflow/${MINIO_BUCKET}/$(date +%Y-%m-%d)/" >/dev/null
}

if command -v mc >/dev/null 2>&1; then
  upload_with_mc mc && bold "    Uploaded via local mc." || err "    mc upload failed (non-fatal)."
else
  # Fall back to the official mc container. host.docker.internal reaches the
  # host on macOS/Windows; on Linux use --add-host below (docker >= 20.10).
  DOCKER_MINIO_ENDPOINT="${MINIO_ENDPOINT/localhost/host.docker.internal}"
  if docker run --rm \
      --add-host host.docker.internal:host-gateway \
      -v "$FHIR_DIR:/bundles:ro" \
      --entrypoint /bin/sh \
      minio/mc:RELEASE.2024-06-12T14-34-03Z \
      -c "mc alias set medflow '$DOCKER_MINIO_ENDPOINT' '$MINIO_ACCESS_KEY' '$MINIO_SECRET_KEY' >/dev/null && \
          mc mb --ignore-existing medflow/${MINIO_BUCKET} >/dev/null && \
          mc cp --recursive /bundles/ medflow/${MINIO_BUCKET}/$(date +%Y-%m-%d)/ >/dev/null"; then
    bold "    Uploaded via dockerized mc."
  else
    err "    MinIO upload failed (non-fatal) — bundles remain in ${FHIR_DIR}."
  fi
fi

# ── 4. Demographic summary (parsed from the generated bundles) ───────────────
bold "==> [4/4] Demographic summary"

python3 - "$FHIR_DIR" <<'PYEOF'
from __future__ import annotations

import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

fhir_dir = Path(sys.argv[1])
genders: Counter = Counter()
age_buckets: Counter = Counter()
cities: Counter = Counter()
conditions: Counter = Counter()
patients = 0

for path in sorted(fhir_dir.glob("*.json")):
    if path.name.startswith(("hospitalInformation", "practitionerInformation")):
        continue
    try:
        bundle = json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        continue
    for entry in bundle.get("entry", []):
        res = entry.get("resource", {})
        rt = res.get("resourceType")
        if rt == "Patient":
            patients += 1
            genders[res.get("gender", "unknown")] += 1
            bd = res.get("birthDate")
            if bd:
                try:
                    age = (date.today() - date.fromisoformat(bd[:10])).days // 365
                    age_buckets[f"{(age // 10) * 10:>3}-{(age // 10) * 10 + 9}"] += 1
                except ValueError:
                    pass
            for addr in res.get("address", []):
                if addr.get("city"):
                    cities[addr["city"]] += 1
        elif rt == "Condition":
            text = (res.get("code") or {}).get("text")
            if text:
                conditions[text] += 1

print(f"  Patients generated : {patients}")
print("  Gender             : " + ", ".join(f"{g}={n}" for g, n in genders.most_common()))
print("  Age distribution   :")
for bucket, n in sorted(age_buckets.items()):
    print(f"    {bucket} yrs : {'#' * max(1, n * 40 // max(1, patients))} {n}")
print("  Top cities         : " + ", ".join(f"{c} ({n})" for c, n in cities.most_common(5)))
print("  Top conditions     : " + ", ".join(f"{c} ({n})" for c, n in conditions.most_common(5)))
PYEOF

bold "Done. Try: open http://localhost:3000 (clinician dashboard) or curl '${FHIR_BASE}/Patient?_count=5'"
