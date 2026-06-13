/**
 * src/metrics.ts — Prometheus metrics using prom-client 15.1.2.
 *
 * Registers:
 *   - events_written_total  (counter)   — incremented after each successful DB write
 *   - queue_depth           (gauge)     — current in-flight items in the write queue
 *   - verify_runs_total     (counter)   — incremented on each /v1/verify call
 */

import { Registry, Counter, Gauge, collectDefaultMetrics } from "prom-client";

export const registry = new Registry();

// Collect Node.js default metrics (event loop lag, heap, GC, etc.)
collectDefaultMetrics({ register: registry });

export const eventsWrittenCounter = new Counter({
  name: "audit_events_written_total",
  help: "Total number of audit events successfully written to audit_log",
  registers: [registry],
});

export const queueDepthGauge = new Gauge({
  name: "audit_queue_depth",
  help: "Current number of events waiting in the in-process write queue",
  registers: [registry],
});

export const verifyRunsCounter = new Counter({
  name: "audit_verify_runs_total",
  help: "Total number of /v1/verify chain verification runs",
  registers: [registry],
});
