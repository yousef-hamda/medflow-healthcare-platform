"""Fire-and-forget audit trail for de-identification events.

Every de-identification call SHOULD leave an audit trail (who/what/why), but
the audit log must NEVER be on the request critical path: a slow or down
audit-service cannot be allowed to slow down or fail PHI de-identification.

Design
------
- ``AuditClient.emit`` is synchronous and non-blocking: it drops the event onto
  a bounded ``asyncio.Queue`` and returns immediately. If the queue is full
  (audit-service is backed up / down) the event is dropped and counted — the
  request path is never blocked or failed.
- A single background worker drains the queue and POSTs each event to
  ``{AUDIT_SERVICE_URL}/v1/events`` with bounded retries and exponential
  backoff. All failures degrade silently (logged at debug/warning, never
  raised).
- Events carry only structural metadata (action, resourceType, an opaque
  resourceId, justification). They never carry PHI values.

The audit event body conforms to the audit-service ``AuditEvent`` contract:
``{actorId, actorRole, action, resourceType, resourceId, justification}``.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING

import httpx
import structlog

from medflow_deid.metrics import AUDIT_EVENTS

if TYPE_CHECKING:
    from medflow_deid.config import Settings

log = structlog.get_logger(__name__)

ACTOR_ID = "deid-service"
ACTOR_ROLE = "service"
_EVENTS_PATH = "/v1/events"


@dataclass(frozen=True)
class AuditEvent:
    """One audit record. Contains no PHI values — identifiers only."""

    action: str
    resource_type: str
    resource_id: str
    justification: str

    def to_payload(self) -> dict[str, str]:
        return {
            "actorId": ACTOR_ID,
            "actorRole": ACTOR_ROLE,
            "action": self.action,
            "resourceType": self.resource_type,
            "resourceId": self.resource_id,
            "justification": self.justification,
        }


class AuditClient:
    """Bounded, fire-and-forget audit emitter with a background delivery worker."""

    def __init__(
        self,
        base_url: str,
        *,
        queue_size: int = 1000,
        retry_attempts: int = 3,
        timeout: float = 2.0,
    ) -> None:
        # Accept either the bare service URL or one that already ends in the
        # events path, so AUDIT_SERVICE_URL can be configured either way.
        base = base_url.rstrip("/")
        self._endpoint = base if base.endswith(_EVENTS_PATH) else base + _EVENTS_PATH
        self._queue: asyncio.Queue[AuditEvent] = asyncio.Queue(maxsize=queue_size)
        self._retry_attempts = max(1, retry_attempts)
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None
        self._worker: asyncio.Task[None] | None = None

    @classmethod
    def from_settings(cls, settings: Settings) -> AuditClient:
        return cls(
            settings.audit_service_url,
            queue_size=settings.audit_queue_size,
            retry_attempts=settings.audit_retry_attempts,
        )

    async def start(self) -> None:
        if self._worker is not None:
            return
        self._client = httpx.AsyncClient(timeout=self._timeout)
        self._worker = asyncio.create_task(self._run(), name="audit-worker")
        log.info("audit_worker_started", endpoint=self._endpoint)

    async def stop(self) -> None:
        if self._worker is not None:
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
            self._worker = None
        if self._client is not None:
            await self._client.aclose()
            self._client = None
        log.info("audit_worker_stopped")

    def emit(
        self, action: str, resource_type: str, resource_id: str, justification: str
    ) -> None:
        """Enqueue an audit event. Never blocks; drops (and counts) when full."""
        event = AuditEvent(action, resource_type, resource_id, justification)
        try:
            self._queue.put_nowait(event)
            AUDIT_EVENTS.labels(outcome="enqueued").inc()
        except asyncio.QueueFull:
            AUDIT_EVENTS.labels(outcome="dropped").inc()
            log.warning("audit_queue_full_event_dropped", action=action)

    async def _run(self) -> None:
        while True:
            event = await self._queue.get()
            try:
                await self._deliver(event)
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - defensive; never propagate
                AUDIT_EVENTS.labels(outcome="failed").inc()
                log.debug("audit_delivery_unexpected_error", exc_info=True)
            finally:
                self._queue.task_done()

    async def _deliver(self, event: AuditEvent) -> None:
        assert self._client is not None
        payload = event.to_payload()
        for attempt in range(1, self._retry_attempts + 1):
            try:
                resp = await self._client.post(self._endpoint, json=payload)
                if resp.status_code < 300:
                    AUDIT_EVENTS.labels(outcome="delivered").inc()
                    return
                log.debug(
                    "audit_delivery_non_2xx",
                    status=resp.status_code,
                    attempt=attempt,
                )
            except Exception:
                log.debug("audit_delivery_attempt_failed", attempt=attempt, exc_info=True)
            if attempt < self._retry_attempts:
                await asyncio.sleep(min(2.0**attempt * 0.1, 2.0))
        AUDIT_EVENTS.labels(outcome="failed").inc()


class NullAuditClient(AuditClient):
    """No-op audit client for tests: records emitted events, no network."""

    def __init__(self) -> None:  # noqa: D401 - intentionally not calling super().__init__ fully
        super().__init__("http://audit.invalid")
        self.events: list[AuditEvent] = []

    async def start(self) -> None:  # pragma: no cover - trivial
        return

    async def stop(self) -> None:  # pragma: no cover - trivial
        return

    def emit(
        self, action: str, resource_type: str, resource_id: str, justification: str
    ) -> None:
        self.events.append(AuditEvent(action, resource_type, resource_id, justification))
        AUDIT_EVENTS.labels(outcome="enqueued").inc()
