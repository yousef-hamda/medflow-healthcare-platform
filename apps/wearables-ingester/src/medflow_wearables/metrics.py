"""Prometheus metrics for the wearables ingester."""

from __future__ import annotations

from prometheus_client import Counter

VITALS_ACCEPTED = Counter(
    "vitals_accepted_total", "Vitals readings accepted", ["source"]
)
VITALS_REJECTED = Counter(
    "vitals_rejected_total", "Vitals readings rejected by validation", ["source", "reason"]
)
VITALS_DUPLICATES = Counter(
    "vitals_duplicates_total", "Vitals readings dropped as duplicates", ["source"]
)
MQTT_MESSAGES = Counter(
    "mqtt_messages_total", "MQTT messages received", ["outcome"]
)
KAFKA_PUBLISH_FAILURES = Counter(
    "kafka_publish_failures_total", "Kafka produce failures for vitals.raw"
)
