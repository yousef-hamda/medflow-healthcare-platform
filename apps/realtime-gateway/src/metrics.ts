/**
 * Prometheus metrics via prom-client.
 *
 * Exposed on GET /metrics (same HTTP port as Socket.IO).
 */

import client from "prom-client";

// Collect default Node.js metrics (heap, event loop lag, GC, etc.)
client.collectDefaultMetrics({ prefix: "rg_" });

/** Number of currently connected Socket.IO clients. */
export const connectionsGauge = new client.Gauge({
  name: "rg_connections_total",
  help: "Number of currently connected Socket.IO clients",
});

/** Total events emitted to Socket.IO rooms (from Kafka fan-out). */
export const eventsEmittedCounter = new client.Counter({
  name: "rg_events_emitted_total",
  help: "Total events emitted into Socket.IO rooms from Kafka",
  labelNames: ["topic", "event_type"] as const,
});

/** Total replay events sent to individual sockets on (re)join. */
export const replayCounter = new client.Counter({
  name: "rg_replay_events_total",
  help: "Total events replayed to sockets from the Redis ring buffer",
  labelNames: ["room"] as const,
});

/** Total join authorisation decisions. */
export const joinAuthCounter = new client.Counter({
  name: "rg_join_auth_total",
  help: "Total room join authorisation decisions",
  labelNames: ["outcome"] as const,
});

export { client as promClient };
