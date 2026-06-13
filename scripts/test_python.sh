#!/usr/bin/env bash
# test_python.sh — Run pytest for every Python service in the monorepo and
# print a summary table (used by `make test`).
#
# Usage:   ./scripts/test_python.sh [extra pytest args...]
#
# Each service is tested from its own directory with PYTHONPATH=src so tests
# import the package the same way CI does. Exits non-zero if ANY suite fails.
# Directories without tests, or environments without pytest, are reported as
# SKIP rather than failing the run.

set -uo pipefail

PYTHON_DIRS=(
  apps/dicom-receiver
  apps/wearables-ingester
  apps/deid-service
  apps/ml-serving
  apps/ml-batch
)

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

if ! python3 -m pytest --version >/dev/null 2>&1; then
  err "pytest is not importable by python3 — install dev deps first:"
  err "  pip install pytest pytest-cov   (or use each service's pyproject extras)"
  exit 1
fi

results=()   # "dir|status|detail"
overall=0

for dir in "${PYTHON_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    results+=("$dir|SKIP|directory not found")
    continue
  fi
  if [ ! -d "$dir/tests" ]; then
    results+=("$dir|SKIP|no tests/ directory")
    continue
  fi

  bold ""
  bold "==> pytest: $dir"
  if (cd "$dir" && PYTHONPATH=src python3 -m pytest tests -q "$@"); then
    results+=("$dir|PASS|")
  else
    rc=$?
    if [ "$rc" -eq 5 ]; then   # pytest exit 5 = no tests collected
      results+=("$dir|SKIP|no tests collected")
    else
      results+=("$dir|FAIL|exit code $rc")
      overall=1
    fi
  fi
done

# ── Summary table ─────────────────────────────────────────────────────────────
bold ""
bold "── Python test summary ────────────────────────────────────"
printf '  %-28s %-6s %s\n' "SERVICE" "STATUS" "DETAIL"
for row in "${results[@]}"; do
  IFS='|' read -r dir status detail <<< "$row"
  case "$status" in
    PASS) printf '  %-28s \033[32m%-6s\033[0m %s\n' "$dir" "$status" "$detail" ;;
    FAIL) printf '  %-28s \033[31m%-6s\033[0m %s\n' "$dir" "$status" "$detail" ;;
    *)    printf '  %-28s \033[33m%-6s\033[0m %s\n' "$dir" "$status" "$detail" ;;
  esac
done

exit "$overall"
