#!/usr/bin/env bash
# submit_flink_job.sh — Submit the PyFlink sepsis alerting job to the local
# Flink cluster (used by `make flink`).
#
# Usage:   ./scripts/submit_flink_job.sh
#
# Pre-flight checks: docker present, jobmanager container running, REST API
# answering, and the job file mounted at /opt/medflow/flink/sepsis_alerting.py
# (bind-mounted from ./data/flink in docker-compose.yml).

set -euo pipefail

JOB_FILE="/opt/medflow/flink/sepsis_alerting.py"
JOBMANAGER_CONTAINER="${JOBMANAGER_CONTAINER:-medflow-flink-jobmanager-1}"
REST_URL="${FLINK_REST_URL:-http://localhost:8082}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

# ── Pre-flight ────────────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || { err "docker is required"; exit 1; }

if ! docker ps --format '{{.Names}}' | grep -qx "$JOBMANAGER_CONTAINER"; then
  err "Flink jobmanager container '$JOBMANAGER_CONTAINER' is not running."
  err "Start it with: docker compose up -d flink-jobmanager flink-taskmanager"
  exit 1
fi

bold "==> Waiting for Flink REST API at ${REST_URL}"
for i in $(seq 1 24); do
  if curl -sf -o /dev/null "${REST_URL}/overview"; then break; fi
  if [ "$i" -eq 24 ]; then err "Flink REST API not reachable at ${REST_URL}"; exit 1; fi
  echo "    waiting (${i}/24)..."
  sleep 5
done

if ! docker compose exec -T flink-jobmanager test -f "$JOB_FILE"; then
  err "Job file ${JOB_FILE} not found inside the jobmanager container."
  err "Expected bind mount ./data/flink -> /opt/medflow/flink (docker-compose.yml)."
  exit 1
fi

# Skip resubmission if the job is already RUNNING.
if curl -sf "${REST_URL}/jobs/overview" 2>/dev/null \
    | grep -q '"name":"[^"]*sepsis[^"]*","state":"RUNNING"'; then
  bold "Sepsis alerting job is already RUNNING — nothing to do."
  bold "Cancel it from the Flink UI (${REST_URL}) to resubmit."
  exit 0
fi

# ── Submit ────────────────────────────────────────────────────────────────────
bold "==> Submitting PyFlink job: ${JOB_FILE} (detached)"
docker compose exec -T flink-jobmanager flink run --detached -py "$JOB_FILE"

bold ""
bold "Submitted. Watch it at ${REST_URL} (Flink UI) or:"
bold "  docker compose logs -f flink-taskmanager"
bold "Feed it data with: make sim-vitals"
