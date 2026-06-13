/**
 * Entry point for the MedFlow realtime-gateway service.
 *
 * Import order is intentional:
 *  1. telemetry.ts — patches instrumentation before any I/O libraries load.
 *  2. Everything else.
 */

import "./telemetry.js";

import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createRedisClient } from "./redis.js";
import { buildHttpRouter } from "./http/router.js";
import { createSocketServer } from "./socketServer.js";
import { buildCareTeamFetcher } from "./auth/careTeamFetcher.js";
import { startKafkaConsumer } from "./kafka/consumer.js";
import type { RedisBuffer } from "./replay/ringBuffer.js";
import type { Redis } from "./redis.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info({ config: { ...config, jwtSigningKey: "[REDACTED]" } }, "Starting realtime-gateway");

  // --- Redis ---
  const redisClient = createRedisClient(config.redisUrl, logger);
  await redisClient.connect();

  // Adapter: ioredis → RedisBuffer interface (needed by kafka consumer)
  const redisBuffer: RedisBuffer = {
    incr: (key) => redisClient.incr(key),
    lpush: (key, value) => redisClient.lpush(key, value),
    ltrim: async (key, start, stop) => {
      await redisClient.ltrim(key, start, stop);
    },
    lrange: (key, start, stop) => redisClient.lrange(key, start, stop),
  };

  // --- HTTP server ---
  // The router is set up after we have the kafka consumer handle; we use a
  // deferred approach: placeholder handler is replaced once kafka is ready.
  // For simplicity we build the http server first, then attach Socket.IO,
  // then start Kafka and replace the request listener.
  const httpServer = createServer();

  // --- Socket.IO ---
  const fetchCareTeam = buildCareTeamFetcher(config.apiGatewayUrl, logger);

  const io = createSocketServer(httpServer, {
    jwtSigningKey: config.jwtSigningKey,
    fetchCareTeam,
    redis: redisClient as unknown as Redis,
    logger,
  });

  // --- Kafka consumer ---
  const consumer = await startKafkaConsumer({
    brokers: config.kafkaBrokers,
    logger,
    io,
    redis: redisBuffer,
  });

  // --- HTTP routes (healthz, metrics) ---
  // Now that we have the consumer handle we can build the router.
  const requestHandler = buildHttpRouter(consumer, redisClient as unknown as Redis, logger);

  // Socket.IO uses the "request" event internally; we add our handler as a
  // listener that only intercepts non-Socket.IO paths.
  httpServer.on("request", requestHandler);

  // --- Start listening ---
  await new Promise<void>((resolve) => {
    httpServer.listen(config.httpPort, () => {
      logger.info({ port: config.httpPort }, "realtime-gateway listening");
      resolve();
    });
  });

  // --- Graceful shutdown ---
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutting down...");
    try {
      io.close();
      await consumer.disconnect();
      await redisClient.quit();
      httpServer.close();
      logger.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error", err);
  process.exit(1);
});
