#!/bin/bash
# Superset bootstrap for the MedFlow local stack.
# Migrates the metadata DB, creates the dev admin user, imports MedFlow assets
# (Trino database connection + OMOP dashboard) if present, then starts gunicorn.
set -e

echo "[superset-init] running database migrations"
superset db upgrade

echo "[superset-init] ensuring admin user exists (admin/admin — dev only)"
superset fab create-admin \
  --username admin \
  --password admin \
  --firstname Med \
  --lastname Flow \
  --email admin@medflow.local || true

echo "[superset-init] superset init (roles/permissions)"
superset init

if [ -d /app/medflow-assets ] && [ -n "$(ls -A /app/medflow-assets 2>/dev/null)" ]; then
  echo "[superset-init] importing MedFlow assets from /app/medflow-assets"
  for asset in /app/medflow-assets/*.yaml /app/medflow-assets/*.zip; do
    [ -e "$asset" ] || continue
    echo "[superset-init]   importing ${asset}"
    superset import-dashboards --path "$asset" --username admin || \
      echo "[superset-init]   WARN: import of ${asset} failed, continuing"
  done
else
  echo "[superset-init] no assets found, skipping import"
fi

echo "[superset-init] starting gunicorn on :8088"
exec gunicorn \
  --bind 0.0.0.0:8088 \
  --workers 2 \
  --worker-class gthread \
  --threads 8 \
  --timeout 120 \
  --limit-request-line 0 \
  --limit-request-field_size 0 \
  "superset.app:create_app()"
