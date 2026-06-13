#!/usr/bin/env bash
# Creates the per-service databases on first boot of the local Postgres container.
set -euo pipefail

databases=(fhir audit vitals gateway predictions mlflow airflow superset marquez feast)

for db in "${databases[@]}"; do
  echo "Creating database: ${db}"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ${db}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${db}')\gexec
EOSQL
done
