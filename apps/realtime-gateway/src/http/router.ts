/**
 * Minimal HTTP router for the management endpoints (/healthz, /metrics).
 *
 * Socket.IO already attaches itself to the Node http.Server so we only need
 * to handle these two paths; everything else returns 404.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Consumer } from "kafkajs";
import type { Redis } from "../redis.js";
import type { Logger } from "../logger.js";
import { buildHealthzHandler } from "./healthz.js";
import { buildMetricsHandler } from "./metricsHandler.js";

export function buildHttpRouter(
  consumer: Consumer,
  redis: Redis,
  logger: Logger,
): (req: IncomingMessage, res: ServerResponse) => void {
  const healthz = buildHealthzHandler(consumer, redis, logger);
  const metrics = buildMetricsHandler();

  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (method === "GET" && url === "/healthz") {
      healthz(req, res);
      return;
    }

    if (method === "GET" && url === "/metrics") {
      metrics(req, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  };
}
