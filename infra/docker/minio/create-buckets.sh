#!/bin/sh
# Creates the canonical MedFlow buckets. The audit-worm bucket gets object locking
# (WORM) so exported audit snapshots cannot be altered or deleted.
set -eu

mc alias set local http://minio:9000 minio_admin minio_dev_password

for bucket in lakehouse imaging manifests mlflow-artifacts drift-reports synthea-raw; do
  mc mb --ignore-existing "local/${bucket}"
  echo "bucket ready: ${bucket}"
done

# WORM bucket: object lock must be set at creation time.
if ! mc ls local/audit-worm >/dev/null 2>&1; then
  mc mb --with-lock local/audit-worm
  mc retention set --default compliance 2190d local/audit-worm
  echo "bucket ready: audit-worm (object-locked, 6y retention)"
fi
