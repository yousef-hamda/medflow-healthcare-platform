"""Prometheus metrics for the de-identification service."""

from __future__ import annotations

from prometheus_client import Counter, Gauge

DEID_REQUESTS = Counter(
    "deid_requests_total", "De-identification requests", ["endpoint", "status"]
)
DEID_ENTITIES_REMOVED = Counter(
    "deid_entities_removed_total", "PHI entities removed, by type", ["entity_type"]
)
AUDIT_EVENTS = Counter(
    "deid_audit_events_total", "Audit events by delivery outcome", ["outcome"]
)
PRESIDIO_ENABLED = Gauge(
    "deid_presidio_enabled", "1 if Presidio NLP analysis is active, 0 if regex-only fallback"
)
