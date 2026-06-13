#!/usr/bin/env bash
# compliance_report.sh — Generate the MedFlow compliance posture report.
#
# Usage:   ./scripts/compliance_report.sh        (or: make compliance-report)
#
# Emits Markdown to stdout AND saves a copy to
# .volumes/compliance-report-YYYY-MM-DD.md. Checks (all best-effort — a dead
# service is reported, not fatal):
#   1. Audit log hash-chain verification     (audit-service :8095/v1/verify)
#   2. Vault transit encryption key presence (PHI field-level encryption)
#   3. Container image vulnerability summary (trivy, if installed)
#   4. Great Expectations checkpoint status  (informational note)
#   5. Image signature spot-check            (cosign, if installed)
#
# All data is synthetic. No real PHI is ever used.

set -euo pipefail

AUDIT_URL="${AUDIT_URL:-http://localhost:8095}"
VAULT_ADDR="${VAULT_ADDR:-http://localhost:8200}"
VAULT_TOKEN="${VAULT_TOKEN:-medflow-dev-root}"   # dev-only default token
TRANSIT_KEY="${TRANSIT_KEY:-medflow-phi}"
REPORT_DIR="$PWD/.volumes"
REPORT_FILE="$REPORT_DIR/compliance-report-$(date +%Y-%m-%d).md"

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
mkdir -p "$REPORT_DIR"

# Everything echoed inside the block is teed to the dated report file.
{
  echo "# MedFlow Compliance Posture Report"
  echo ""
  echo "- **Generated:** $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  echo "- **Host:** $(hostname)"
  echo "- **Scope:** local development stack (all data synthetic — no real PHI)"
  echo ""

  # ── 1. Audit chain ──────────────────────────────────────────────────────────
  echo "## 1. Audit log integrity (hash chain)"
  echo ""
  verify_json="$(curl -sf --max-time 10 "$AUDIT_URL/v1/verify" 2>/dev/null || true)"
  if [ -n "$verify_json" ]; then
    echo '```json'
    echo "$verify_json"
    echo '```'
    if echo "$verify_json" | grep -qiE '"(valid|ok|intact)"[[:space:]]*:[[:space:]]*true'; then
      echo ""
      echo "**Status: PASS** — audit hash chain verified end-to-end."
    else
      echo ""
      echo "**Status: REVIEW** — verify endpoint responded but did not report a valid chain."
    fi
  else
    echo "**Status: UNAVAILABLE** — audit-service not reachable at \`$AUDIT_URL/v1/verify\`."
    echo "Bring the stack up (\`make dev\`) and re-run."
  fi
  echo ""

  # ── 2. Vault transit key (field-level PHI encryption) ──────────────────────
  echo "## 2. Encryption at rest — Vault transit key"
  echo ""
  key_json="$(curl -sf --max-time 10 \
      -H "X-Vault-Token: $VAULT_TOKEN" \
      "$VAULT_ADDR/v1/transit/keys/$TRANSIT_KEY" 2>/dev/null || true)"
  if [ -n "$key_json" ]; then
    echo "**Status: PASS** — transit key \`$TRANSIT_KEY\` present at \`$VAULT_ADDR\`."
    echo ""
    echo '```json'
    # Show key metadata only (type/latest_version), never key material.
    echo "$key_json" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin).get("data", {})
    print(json.dumps({k: d.get(k) for k in ("name", "type", "latest_version",
                                            "deletion_allowed", "exportable")}, indent=2))
except Exception:
    print("{\"note\": \"could not parse Vault response\"}")'
    echo '```'
  else
    echo "**Status: FAIL/UNAVAILABLE** — transit key \`$TRANSIT_KEY\` not readable at"
    echo "\`$VAULT_ADDR\` (check VAULT_TOKEN, or run the vault-init bootstrap)."
  fi
  echo ""

  # ── 3. Vulnerability scan summary ───────────────────────────────────────────
  echo "## 3. Container vulnerability summary (trivy)"
  echo ""
  if command -v trivy >/dev/null 2>&1; then
    images="$(docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
                | grep -E '^medflow' | sort -u || true)"
    if [ -z "$images" ]; then
      echo "_No medflow-* images found locally — run \`make dev-build\` first._"
    else
      echo "| Image | HIGH | CRITICAL |"
      echo "|-------|------|----------|"
      for img in $images; do
        counts="$(trivy image --quiet --severity HIGH,CRITICAL --format json "$img" 2>/dev/null \
          | python3 -c '
import json, sys
try:
    res = json.load(sys.stdin).get("Results") or []
except Exception:
    print("? ?"); raise SystemExit
h = c = 0
for r in res:
    for v in r.get("Vulnerabilities") or []:
        if v.get("Severity") == "HIGH": h += 1
        elif v.get("Severity") == "CRITICAL": c += 1
print(h, c)' || echo "? ?")"
        echo "| \`$img\` | $(echo "$counts" | awk '{print $1}') | $(echo "$counts" | awk '{print $2}') |"
      done
      echo ""
      echo "Full gate: \`make scan\` (fails on any HIGH/CRITICAL)."
    fi
  else
    echo "_trivy not installed — skipped. Install: \`brew install trivy\`._"
  fi
  echo ""

  # ── 4. Data quality (Great Expectations) ───────────────────────────────────
  echo "## 4. Data quality — Great Expectations checkpoints"
  echo ""
  echo "GE checkpoints run inside the Airflow DAGs (suite: \`data/great_expectations\`)."
  echo "Latest run status is visible in the Airflow UI (http://localhost:8080,"
  echo "task group \`ge_validate\`) and validation results land in the GE data docs."
  echo "This report does not re-execute checkpoints; treat a red Airflow task as a"
  echo "compliance finding for the affected pipeline run."
  echo ""

  # ── 5. Image signatures ─────────────────────────────────────────────────────
  echo "## 5. Image signature spot-check (cosign)"
  echo ""
  if command -v cosign >/dev/null 2>&1; then
    spot="${COSIGN_IMAGE:-ghcr.io/yousef-hamda/medflow-ml-serving:latest}"
    echo "Spot-checking \`$spot\` (keyless, GitHub Actions OIDC identity):"
    echo ""
    echo '```'
    if cosign verify \
        --certificate-identity-regexp 'https://github.com/.*/medflow.*' \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com \
        "$spot" 2>&1 | tail -n 5; then
      echo '```'
      echo ""
      echo "**Status: PASS** — signature verified."
    else
      echo '```'
      echo ""
      echo "**Status: REVIEW** — verification failed (expected for purely local builds;"
      echo "CI-signed images on GHCR should pass)."
    fi
  else
    echo "_cosign not installed — skipped. Install: \`brew install cosign\`._"
  fi
  echo ""
  echo "---"
  echo "_Report saved to ${REPORT_FILE}_"
} | tee "$REPORT_FILE"
