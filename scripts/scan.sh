#!/usr/bin/env bash
# scan.sh — Trivy-scan every local medflow-* image; fail on HIGH/CRITICAL.
#
# Usage:   ./scripts/scan.sh          (or: make scan)
#
# Mirrors the CI security gate (.github/workflows/ci.yml): any HIGH or
# CRITICAL vulnerability makes this script exit non-zero.

set -euo pipefail

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

command -v trivy  >/dev/null 2>&1 || { err "trivy is required (brew install trivy)"; exit 1; }
command -v docker >/dev/null 2>&1 || { err "docker is required"; exit 1; }

images="$(docker images --format '{{.Repository}}:{{.Tag}}' \
            | grep -E '^medflow' | grep -v '<none>' | sort -u || true)"

if [ -z "$images" ]; then
  err "No medflow-* images found. Build them first: make dev-build"
  exit 1
fi

bold "Scanning $(echo "$images" | wc -l | tr -d ' ') medflow images (HIGH,CRITICAL gate)"

failed=()
for img in $images; do
  echo ""
  bold "==> trivy image $img"
  if ! trivy image --severity HIGH,CRITICAL --exit-code 1 --ignore-unfixed "$img"; then
    failed+=("$img")
  fi
done

echo ""
if [ "${#failed[@]}" -gt 0 ]; then
  err "FAILED — HIGH/CRITICAL vulnerabilities in ${#failed[@]} image(s):"
  for img in "${failed[@]}"; do err "  - $img"; done
  exit 1
fi
bold "All images clean at HIGH/CRITICAL severity."
