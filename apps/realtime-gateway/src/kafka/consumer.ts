/**
 * KafkaJS consumer that subscribes to the three MedFlow event topics and
 * fan-outs validated messages into Socket.IO rooms via the provided emitter.
 *
 * Topics → Socket.IO events:
 *   alerts            → "sepsis-alert" (when alert.type === "sepsis") | "alert"
 *   vitals.aggregates → "vitals-update"
 *   predictions       → "prediction"
 *
 * Every consumed message is validated with the corresponding Zod schema.
 * Invalid messages are dropped with a warning — never crash the consumer.
 */

import { Kafka, type Consumer, logLevel as KafkaLogLevel } from "kafkajs";
import type { Server as SocketServer } from "socket.io";
import {
  KafkaAlertEventSchema,
  VitalsReadingSchema,
  PredictionEventSchema,
} from "@medflow/shared-types";
import type { Logger } from "../logger.js";
import type { RedisBuffer } from "../replay/ringBuffer.js";
import { pushToBuffer } from "../replay/ringBuffer.js";
import { eventsEmittedCounter } from "../metrics.js";

export const TOPICS = {
  ALERTS: "alerts",
  VITALS: "vitals.aggregates",
  PREDICTIONS: "predictions",
} as const;

type TopicName = (typeof TOPICS)[keyof typeof TOPICS];

export interface KafkaConsumerOptions {
  brokers: string[];
  groupId?: string;
  logger: Logger;
  io: SocketServer;
  redis: RedisBuffer;
}

/**
 * Creates and starts the KafkaJS consumer.
 * Returns the consumer instance so the caller can disconnect on shutdown.
 */
export async function startKafkaConsumer(opts: KafkaConsumerOptions): Promise<Consumer> {
  const { brokers, groupId = "realtime-gateway", logger, io, redis } = opts;

  const kafka = new Kafka({
    clientId: "realtime-gateway",
    brokers,
    // Map KafkaJS log levels to pino — suppress debug noise
    logLevel: KafkaLogLevel.WARN,
    logCreator:
      (_level) =>
      ({ namespace, level, log }) => {
        const { message, ...extra } = log;
        const pinoLevel =
          level === KafkaLogLevel.ERROR
            ? "error"
            : level === KafkaLogLevel.WARN
              ? "warn"
              : "debug";
        logger[pinoLevel]({ namespace, ...extra }, message);
      },
  });

  const consumer = kafka.consumer({ groupId });

  await consumer.connect();
  logger.info({ brokers, groupId }, "Kafka consumer connected");

  await consumer.subscribe({
    topics: [TOPICS.ALERTS, TOPICS.VITALS, TOPICS.PREDICTIONS],
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const raw = message.value?.toString();
      if (!raw) {
        logger.warn({ topic }, "Kafka: received empty message, skipping");
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logger.warn({ topic }, "Kafka: failed to JSON.parse message, skipping");
        return;
      }

      await handleMessage(topic as TopicName, parsed, { logger, io, redis });
    },
  });

  return consumer;
}

/**
 * Validate, route, and emit a single Kafka message.
 * Extracted for testability.
 */
async function handleMessage(
  topic: TopicName,
  parsed: unknown,
  ctx: { logger: Logger; io: SocketServer; redis: RedisBuffer },
): Promise<void> {
  const { logger, io, redis } = ctx;

  switch (topic) {
    case TOPICS.ALERTS: {
      const result = KafkaAlertEventSchema.safeParse(parsed);
      if (!result.success) {
        logger.warn({ topic, issues: result.error.issues }, "Kafka: invalid alert message, dropped");
        return;
      }
      const alert = result.data;
      const room = `patient:${alert.patientId}`;
      const eventName = alert.type === "sepsis" ? "sepsis-alert" : "alert";
      io.to(room).emit(eventName, alert);
      eventsEmittedCounter.inc({ topic, event_type: eventName });
      await pushToBuffer(redis, room, eventName, alert);
      logger.debug({ room, eventName, alertId: alert.id }, "Emitted alert");
      break;
    }

    case TOPICS.VITALS: {
      const result = VitalsReadingSchema.safeParse(parsed);
      if (!result.success) {
        logger.warn({ topic, issues: result.error.issues }, "Kafka: invalid vitals message, dropped");
        return;
      }
      const vitals = result.data;
      const room = `patient:${vitals.patientId}`;
      const eventName = "vitals-update";
      io.to(room).emit(eventName, vitals);
      eventsEmittedCounter.inc({ topic, event_type: eventName });
      await pushToBuffer(redis, room, eventName, vitals);
      logger.debug({ room, patientId: vitals.patientId }, "Emitted vitals-update");
      break;
    }

    case TOPICS.PREDICTIONS: {
      const result = PredictionEventSchema.safeParse(parsed);
      if (!result.success) {
        logger.warn({ topic, issues: result.error.issues }, "Kafka: invalid prediction message, dropped");
        return;
      }
      const prediction = result.data;
      const room = `patient:${prediction.patientId}`;
      const eventName = "prediction";
      io.to(room).emit(eventName, prediction);
      eventsEmittedCounter.inc({ topic, event_type: eventName });
      await pushToBuffer(redis, room, eventName, prediction);
      logger.debug({ room, predictionId: prediction.id }, "Emitted prediction");
      break;
    }

    default: {
      logger.warn({ topic }, "Kafka: received message on unknown topic, skipping");
    }
  }
}
