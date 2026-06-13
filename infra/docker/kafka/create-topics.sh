#!/usr/bin/env bash
# Creates the canonical MedFlow Kafka topics. Idempotent.
set -euo pipefail

BOOTSTRAP=kafka:9092

topics=(
  "fhir.changes:6"
  "hl7.raw:6"
  "dicom.received:3"
  "vitals.raw:12"
  "vitals.aggregates:6"
  "alerts:3"
  "predictions:6"
  "audit.events:6"
)

for entry in "${topics[@]}"; do
  topic="${entry%%:*}"
  partitions="${entry##*:}"
  kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --create --if-not-exists \
    --topic "$topic" --partitions "$partitions" --replication-factor 1 \
    --config retention.ms=604800000
  echo "topic ready: $topic ($partitions partitions)"
done
