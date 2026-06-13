/**
 * src/kafka.ts — KafkaJS 2.2.4 consumer for the "audit.events" topic.
 *
 * All messages are validated against AuditEventSchema then pushed through the
 * same FIFO write queue as HTTP requests — ensuring the hash chain is never
 * subject to concurrent writes regardless of ingest path.
 *
 * Invalid messages are logged (with PHI-sensitive fields redacted by pino)
 * and skipped; they do NOT cause the consumer to stop or restart.
 */

import { Kafka, logLevel } from "kafkajs";
import type { Consumer } from "kafkajs";
import type { Logger } from "pino";
import { AuditEventSchema } from "@medflow/shared-types";
import type { WriteQueue } from "./queue.js";
import { eventsWrittenCounter } from "./metrics.js";

const TOPIC = "audit.events";
const GROUP_ID = "medflow-audit-service";

let _consumer: Consumer | null = null;

/**
 * Create and connect a KafkaJS consumer.
 * Call once during service startup.
 */
export async function startKafkaConsumer(
  queue: WriteQueue,
  logger: Logger,
): Promise<Consumer> {
  const brokers = (process.env["KAFKA_BROKERS"] ?? "kafka:9092").split(",");

  const kafka = new Kafka({
    clientId: "audit-service",
    brokers,
    logLevel: logLevel.WARN,
    retry: {
      initialRetryTime: 300,
      retries: 10,
    },
  });

  const consumer = kafka.consumer({ groupId: GROUP_ID });
  _consumer = consumer;

  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    // Process one message at a time to preserve order within the FIFO queue
    partitionsConsumedConcurrently: 1,
    eachMessage: async ({ message }) => {
      const raw = message.value?.toString();
      if (raw === undefined || raw === null || raw === "") {
        logger.warn({ topic: TOPIC }, "Received empty Kafka message — skipping");
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        logger.warn({ topic: TOPIC }, "Failed to JSON-parse Kafka message — skipping");
        return;
      }

      const result = AuditEventSchema.safeParse(parsed);
      if (!result.success) {
        // Log the validation error but never log raw message content (may contain PHI)
        logger.warn(
          { topic: TOPIC, issues: result.error.issues },
          "Kafka message failed AuditEventSchema validation — skipping",
        );
        return;
      }

      try {
        await queue.enqueue(result.data);
        eventsWrittenCounter.inc();
      } catch (err: unknown) {
        logger.error(
          { topic: TOPIC, error: String(err) },
          "Failed to write Kafka audit event to DB",
        );
      }
    },
  });

  logger.info({ topic: TOPIC, groupId: GROUP_ID }, "Kafka consumer started");
  return consumer;
}

/**
 * Gracefully disconnect the Kafka consumer.
 * Called during service shutdown.
 */
export async function stopKafkaConsumer(logger: Logger): Promise<void> {
  if (_consumer !== null) {
    try {
      await _consumer.disconnect();
      logger.info("Kafka consumer disconnected");
    } catch (err: unknown) {
      logger.error({ error: String(err) }, "Error disconnecting Kafka consumer");
    }
    _consumer = null;
  }
}

/**
 * Check whether the Kafka consumer is connected — used by /healthz.
 * KafkaJS does not expose a direct isConnected() method; we track it via the
 * module-level reference (non-null = connected).
 */
export function isKafkaConnected(): boolean {
  return _consumer !== null;
}
