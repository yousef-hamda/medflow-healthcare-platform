#!/usr/bin/env bash
# audit_query.sh — Run the example audit-review queries against the audit DB.
#
# Usage:   ./scripts/audit_query.sh          (or: make audit-query)
#
# Loops every compliance/audit-queries/*.sql and executes it against the
# `audit` database with labeled output. Prefers a local psql client; falls
# back to `docker compose exec postgres psql` when psql is not installed.
#
# All data is synthetic. No real PHI is ever used.

set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-medflow}"
PGDATABASE="${PGDATABASE:-audit}"
export PGPASSWORD="${PGPASSWORD:-medflow_dev_password}"
QUERY_DIR="$PWD/compliance/audit-queries"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
err()  { printf '\033[31m%s\033[0m\n' "$*" >&2; }

shopt -s nullglob
sql_files=("$QUERY_DIR"/*.sql)
shopt -u nullglob

if [ "${#sql_files[@]}" -eq 0 ]; then
  err "No queries found in ${QUERY_DIR}/*.sql — add audit-review SQL files there."
  exit 1
fi

# Pick an execution strategy: local psql, else dockerized psql via compose.
if command -v psql >/dev/null 2>&1; then
  run_sql() { psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
                   -v ON_ERROR_STOP=1 -P pager=off -f "$1"; }
  bold "Using local psql against ${PGHOST}:${PGPORT}/${PGDATABASE}"
elif command -v docker >/dev/null 2>&1; then
  run_sql() { docker compose exec -T -e PGPASSWORD="$PGPASSWORD" postgres \
                   psql -U "$PGUSER" -d "$PGDATABASE" \
                   -v ON_ERROR_STOP=1 -P pager=off < "$1"; }
  bold "psql not found — using docker compose exec postgres psql"
else
  err "Neither psql nor docker is available."
  exit 1
fi

failures=0
for f in "${sql_files[@]}"; do
  name="$(basename "$f")"
  # First comment line of each .sql file is used as its human description.
  desc="$(head -n 1 "$f" | sed -e 's/^[[:space:]]*--[[:space:]]*//')"
  echo ""
  bold "════════════════════════════════════════════════════════════════════"
  bold " ${name}"
  [ -n "$desc" ] && echo " ${desc}"
  bold "════════════════════════════════════════════════════════════════════"
  if ! run_sql "$f"; then
    err " FAILED: ${name}"
    failures=$((failures + 1))
  fi
done

echo ""
if [ "$failures" -gt 0 ]; then
  err "${failures}/${#sql_files[@]} audit queries failed."
  exit 1
fi
bold "All ${#sql_files[@]} audit queries completed."
