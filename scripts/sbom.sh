#!/usr/bin/env bash
# sbom.sh — Generate SPDX SBOMs (syft) for every medflow-* image and scan
# them with grype.
#
# Usage:   ./scripts/sbom.sh          (or: make sbom)
#
# Output: sbom/<image>.spdx.json (gitignored artifacts; CI uploads the same
# files as workflow artifacts and attaches them to releases).

set -euo pipefail

SBOM_DIR="$PWD/sbom"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

command -v syft   >/dev/null 2>&1 || { err "syft is required (brew install syft)"; exit 1; }
command -v docker >/dev/null 2>&1 || { err "docker is required"; exit 1; }
have_grype=true
command -v grype >/dev/null 2>&1 || { have_grype=false; err "grype not installed — SBOMs will be generated but not scanned."; }

images="$(docker images --format '{{.Repository}}:{{.Tag}}' \
            | grep -E '^medflow' | grep -v '<none>' | sort -u || true)"

if [ -z "$images" ]; then
  err "No medflow-* images found. Build them first: make dev-build"
  exit 1
fi

mkdir -p "$SBOM_DIR"
vuln_failures=0

for img in $images; do
  # medflow-ml-serving:latest -> medflow-ml-serving.spdx.json
  out="$SBOM_DIR/$(echo "$img" | tr '/:' '__' | sed 's/_latest$//').spdx.json"
  bold "==> syft $img -> $(basename "$out")"
  syft "$img" -o spdx-json="$out" --quiet

  if $have_grype; then
    bold "    grype scan (HIGH/CRITICAL gate)"
    if ! grype "sbom:$out" --fail-on high --only-fixed --quiet; then
      err "    grype found HIGH/CRITICAL vulnerabilities in $img"
      vuln_failures=$((vuln_failures + 1))
    fi
  fi
done

echo ""
bold "SBOMs written to $SBOM_DIR/"
ls -lh "$SBOM_DIR"/*.spdx.json | awk '{print "  " $9 " (" $5 ")"}'

if [ "$vuln_failures" -gt 0 ]; then
  err "grype flagged ${vuln_failures} image(s) — see output above."
  exit 1
fi
