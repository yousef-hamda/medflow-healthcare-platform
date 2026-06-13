/**
 * GET /metrics — Prometheus text format scrape endpoint.
 * Uses prom-client to serialise all registered metrics.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { promClient } from "../metrics.js";

export function buildMetricsHandler(): (
  req: IncomingMessage,
  res: ServerResponse,
) => void {
  return (_req, res) => {
    promClient
      .register.metrics()
      .then((metrics) => {
        res.writeHead(200, { "Content-Type": promClient.register.contentType });
        res.end(metrics);
      })
      .catch((err: unknown) => {
        res.writeHead(500);
        res.end(String(err));
      });
  };
}
