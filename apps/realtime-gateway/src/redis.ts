/**
 * ioredis client factory.
 * The client is created once and shared across the application.
 */

import Redis from "ioredis";
import type { Logger } from "./logger.js";

export function createRedisClient(redisUrl: string, logger: Logger): Redis {
  const client = new Redis(redisUrl, {
    // Prevent ioredis from crashing the process on connection errors at startup
    lazyConnect: true,
    enableReadyCheck: true,
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 10) {
        logger.error({ times }, "Redis: exceeded max reconnect attempts");
        return null; // stop retrying
      }
      return Math.min(times * 100, 3000);
    },
  });

  client.on("connect", () => {
    logger.info("Redis: connected");
  });

  client.on("error", (err: Error) => {
    logger.error({ err: err.message }, "Redis: connection error");
  });

  client.on("close", () => {
    logger.warn("Redis: connection closed");
  });

  return client;
}

export type { Redis };
