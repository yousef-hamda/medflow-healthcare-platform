/**
 * GET /healthz — liveness and readiness probe.
 *
 * Returns 200 when Kafka and Redis are reachable, 503 otherwise.
 * The response body carries per-subsystem status so orchestrators can parse it.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Consumer } from "kafkajs";
import type { Redis } from "../redis.js";
import type { Logger } from "../logger.js";

interface SubsystemStatus {
  status: "ok" | "error";
  detail?: string;
}

interface HealthResponse {
  status: "ok" | "degraded";
  kafka: SubsystemStatus;
  redis: SubsystemStatus;
  uptime: number;
}

/**
 * Checks Kafka connectivity by calling consumer.describeGroup() or simply
 * relying on the consumer's internal connectivity state.
 * KafkaJS doesn't expose a ping — we use a best-effort approach.
 */
async function checkKafka(consumer: Consumer): Promise<SubsystemStatus> {
  try {
    // If the consumer is connected its internal network state will be active.
    // We call pauseTopicPartitions with an empty array as a no-op probe.
    // This is an intentional lightweight probe — no actual partitions are paused.
    await consumer.describeGroup();
    return { status: "ok" };
  } catch (err) {
    return { status: "error", detail: (err as Error).message };
  }
}

async function checkRedis(redis: Redis): Promise<SubsystemStatus> {
  try {
    const pong = await redis.ping();
    return pong === "PONG" ? { status: "ok" } : { status: "error", detail: `unexpected: ${pong}` };
  } catch (err) {
    return { status: "error", detail: (err as Error).message };
  }
}

export function buildHealthzHandler(
  consumer: Consumer,
  redis: Redis,
  logger: Logger,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (_req, res) => {
    // Run both checks in parallel
    Promise.all([checkKafka(consumer), checkRedis(redis)])
      .then(([kafka, redisStatus]) => {
        const healthy = kafka.status === "ok" && redisStatus.status === "ok";
        const body: HealthResponse = {
          status: healthy ? "ok" : "degraded",
          kafka,
          redis: redisStatus,
          uptime: process.uptime(),
        };
        res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      })
      .catch((err: unknown) => {
        logger.error({ err }, "healthz check threw unexpectedly");
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", detail: String(err) }));
      });
  };
}
