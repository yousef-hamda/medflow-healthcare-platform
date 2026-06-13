/**
 * Socket.IO server wiring.
 *
 * Responsibilities:
 *  - Attach JWT middleware to every connection.
 *  - Handle "join" events: authorise, join room, replay missed events.
 *  - Maintain the connections gauge in Prometheus.
 *
 * The actual event emission from Kafka is handled in kafka/consumer.ts which
 * receives the io instance and calls io.to(room).emit(...).
 */

import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import type { Redis } from "./redis.js";
import type { Logger } from "./logger.js";
import type { FetchCareTeam } from "./auth/roomAuth.js";
import { authoriseRoomJoin } from "./auth/roomAuth.js";
import { buildJwtMiddleware } from "./auth/jwtMiddleware.js";
import type { AuthenticatedSocket } from "./auth/jwtMiddleware.js";
import { replayFromBuffer } from "./replay/ringBuffer.js";
import { connectionsGauge, joinAuthCounter, replayCounter } from "./metrics.js";
import type { RedisBuffer } from "./replay/ringBuffer.js";

interface JoinPayload {
  /** Patient id to subscribe to (without the "patient:" prefix). */
  patientId: string;
  /** Last event id the client saw — replay events after this id. 0 = replay nothing. */
  lastEventId?: number;
}

type JoinAck =
  | { success: true; room: string; replayed: number }
  | { success: false; error: string };

/**
 * Adapts ioredis client to the minimal RedisBuffer interface expected by the ring-buffer module.
 */
function toRedisBuffer(redis: Redis): RedisBuffer {
  return {
    incr: (key) => redis.incr(key),
    lpush: (key, value) => redis.lpush(key, value),
    ltrim: async (key, start, stop) => {
      await redis.ltrim(key, start, stop);
    },
    lrange: (key, start, stop) => redis.lrange(key, start, stop),
  };
}

export function createSocketServer(
  httpServer: HttpServer,
  opts: {
    jwtSigningKey: string;
    fetchCareTeam: FetchCareTeam;
    redis: Redis;
    logger: Logger;
    corsOrigin?: string | string[];
  },
): SocketIOServer {
  const { jwtSigningKey, fetchCareTeam, redis, logger } = opts;

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: opts.corsOrigin ?? "*",
      methods: ["GET", "POST"],
    },
    // Allow polling fallback for envs where WebSocket is blocked
    transports: ["websocket", "polling"],
    pingTimeout: 20_000,
    pingInterval: 25_000,
  });

  const redisBuffer = toRedisBuffer(redis);

  // --- JWT middleware (runs on every new connection attempt) ---
  io.use(buildJwtMiddleware(jwtSigningKey, logger));

  // --- Connection handler ---
  io.on("connection", (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const { claims, rawToken } = socket.data;

    connectionsGauge.inc();
    logger.info(
      { socketId: socket.id, sub: claims.sub, role: claims.role },
      "Socket connected",
    );

    // "join" — client wants to subscribe to a patient room
    socket.on("join", (payload: JoinPayload, ack: (result: JoinAck) => void) => {
      const { patientId, lastEventId = 0 } = payload;

      if (!patientId || typeof patientId !== "string") {
        const result: JoinAck = { success: false, error: "patientId is required" };
        ack(result);
        return;
      }

      const room = `patient:${patientId}`;

      authoriseRoomJoin(claims, patientId, rawToken, fetchCareTeam)
        .then(async (decision) => {
          if (!decision.allowed) {
            joinAuthCounter.inc({ outcome: "denied" });
            logger.warn(
              { socketId: socket.id, sub: claims.sub, patientId, reason: decision.reason },
              "Room join denied",
            );
            ack({ success: false, error: decision.reason });
            return;
          }

          joinAuthCounter.inc({ outcome: "allowed" });
          await socket.join(room);
          logger.info(
            { socketId: socket.id, sub: claims.sub, room, reason: decision.reason },
            "Room join allowed",
          );

          // Replay missed events
          let replayed = 0;
          if (lastEventId >= 0) {
            try {
              const missed = await replayFromBuffer(redisBuffer, room, lastEventId);
              for (const entry of missed) {
                socket.emit(entry.event, { ...((entry.payload as object) ?? {}), _eventId: entry.id });
                replayCounter.inc({ room });
                replayed++;
              }
              if (replayed > 0) {
                logger.debug(
                  { socketId: socket.id, room, replayed, sinceEventId: lastEventId },
                  "Replayed missed events",
                );
              }
            } catch (err) {
              logger.error({ err, room }, "Failed to replay events from buffer");
            }
          }

          ack({ success: true, room, replayed });
        })
        .catch((err: unknown) => {
          logger.error({ err, socketId: socket.id, patientId }, "authoriseRoomJoin threw");
          ack({ success: false, error: "internal error during authorisation" });
        });
    });

    socket.on("disconnect", (reason) => {
      connectionsGauge.dec();
      logger.info({ socketId: socket.id, sub: claims.sub, reason }, "Socket disconnected");
    });

    socket.on("error", (err: Error) => {
      logger.error({ socketId: socket.id, err: err.message }, "Socket error");
    });
  });

  return io;
}
