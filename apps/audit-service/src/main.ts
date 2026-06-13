/**
 * src/main.ts — Process entrypoint for the audit service.
 *
 * Import order matters: telemetry.ts must load first so OpenTelemetry
 * auto-instrumentation patches (pg, fastify, kafkajs) are applied before those
 * libraries are imported.
 *
 * Startup sequence:
 *   1. init pg pool + the FIFO write queue (loads the last hash from the DB so
 *      the chain continues across restarts),
 *   2. build the Fastify app,
 *   3. start the Kafka consumer (same write queue as HTTP — single chain),
 *   4. listen.
 */

import "./telemetry.js";

import pino from "pino";
import { getPool } from "./db.js";
import { createWriteQueue } from "./queue.js";
import { buildApp } from "./server.js";
import { startKafkaConsumer, stopKafkaConsumer } from "./kafka.js";

const logger = pino({ level: process.env["LOG_LEVEL"] ?? "info" });
const HTTP_PORT = parseInt(process.env["HTTP_PORT"] ?? "8095", 10);

async function main(): Promise<void> {
  const pool = getPool();

  // The write queue loads the last hash from the DB on init so the hash chain
  // continues correctly after a restart.
  const queue = await createWriteQueue(pool);

  const app = await buildApp(queue);

  // Both ingest paths (HTTP + Kafka) feed the same FIFO queue.
  await startKafkaConsumer(queue, logger);

  await app.listen({ host: "0.0.0.0", port: HTTP_PORT });
  logger.info({ port: HTTP_PORT }, "audit-service listening");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down...");
    try {
      await stopKafkaConsumer(logger);
      await app.close();
      await pool.end();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err: String(err) }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error({ err: String(err) }, "Fatal startup error");
  process.exit(1);
});
