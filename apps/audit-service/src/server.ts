/**
 * src/server.ts — Fastify 4 application factory.
 *
 * Routes:
 *   POST /v1/events          — ingest single or batch AuditEvent
 *   GET  /v1/events          — paginated, filtered query
 *   GET  /v1/verify          — hash-chain verification (streaming)
 *   POST /v1/export/daily    — WORM export to MinIO/S3
 *   GET  /healthz            — liveness + readiness (db/kafka)
 *   GET  /metrics            — Prometheus text exposition
 */

import Fastify from "fastify";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AuditEventSchema } from "@medflow/shared-types";
import type { AuditEvent } from "@medflow/shared-types";
import {
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { Logger } from "pino";

import { buildPinoRedactPaths } from "@medflow/shared-types";
import { verifyChain, TS_EXPR } from "./chain.js";
import type { AuditRow } from "./chain.js";
import { buildFilterClause } from "./filters.js";
import type { EventFilters } from "./filters.js";
import { rowsToJsonl, gzipBuffer, buildExportKey } from "./export.js";
import type { ExportRow } from "./export.js";
import { getPool, checkDbHealth, TS_EXPR as DB_TS_EXPR } from "./db.js";
import type { WriteQueue } from "./queue.js";
import { isKafkaConnected } from "./kafka.js";
import {
  registry,
  eventsWrittenCounter,
  queueDepthGauge,
  verifyRunsCounter,
} from "./metrics.js";

// ---- Zod schemas for route input validation --------------------------------

const BatchSchema = z.union([AuditEventSchema, z.array(AuditEventSchema)]);

const EventQuerySchema = z.object({
  actor: z.string().optional(),
  action: z.string().optional(),
  resourceType: z.string().optional(),
  resourceId: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  breakGlassOnly: z
    .string()
    .transform((v) => v === "true")
    .optional(),
  afterId: z.string().regex(/^\d+$/).optional(),
  limit: z
    .string()
    .transform((v) => Math.min(parseInt(v, 10), 500))
    .optional()
    .default("100"),
});

const DailyExportSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

// ---- DB row types for route queries ----------------------------------------

interface EventRow {
  id: string;
  ts_str: string;
  actor_id: string;
  actor_role: string;
  action: string;
  resource_type: string;
  resource_id: string;
  ip: string | null;
  user_agent: string | null;
  justification: string | null;
  hash: string;
  prev_hash: string;
}

// ---- Fastify factory --------------------------------------------------------

export async function buildApp(
  queue: WriteQueue,
  baseLogger?: Logger,
): Promise<FastifyInstance> {
  // Build pino redact paths — add "justification" since it may contain PHI
  const redactPaths = [
    ...buildPinoRedactPaths(["req", "body"]),
    "justification",
    "*.justification",
    "body.justification",
    "req.body.justification",
  ];

  const app = Fastify({
    logger: baseLogger ?? {
      level: process.env["LOG_LEVEL"] ?? "info",
      redact: {
        paths: redactPaths,
        censor: "[REDACTED]",
      },
    },
    trustProxy: true,
  });

  const pool = getPool();

  // ---- POST /v1/events -------------------------------------------------------

  app.post(
    "/v1/events",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = BatchSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Validation failed",
          issues: parsed.error.issues,
        });
      }

      const events: AuditEvent[] = Array.isArray(parsed.data)
        ? parsed.data
        : [parsed.data];

      // Enqueue all events through the FIFO queue — await each in order so
      // the hash chain is built sequentially within this request too.
      for (const event of events) {
        await queue.enqueue(event);
        eventsWrittenCounter.inc();
      }

      return reply.status(202).send({ accepted: events.length });
    },
  );

  // ---- GET /v1/events --------------------------------------------------------

  app.get(
    "/v1/events",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const qp = EventQuerySchema.safeParse(req.query);
      if (!qp.success) {
        return reply.status(400).send({
          error: "Invalid query parameters",
          issues: qp.error.issues,
        });
      }

      const {
        actor,
        action,
        resourceType,
        resourceId,
        from,
        to,
        breakGlassOnly,
        afterId,
        limit,
      } = qp.data;

      const filters: EventFilters = {
        actor,
        action,
        resourceType,
        resourceId,
        from,
        to,
        breakGlassOnly,
        afterId,
      };

      const { where, params, nextParamIndex } = buildFilterClause(filters);

      // Append LIMIT as the next positional parameter
      const limitParam = `$${nextParamIndex}`;
      params.push(limit);

      const whereSql = where !== "" ? `WHERE ${where}` : "";

      const sql = `
        SELECT
          id::text,
          ${TS_EXPR} AS ts_str,
          actor_id,
          actor_role,
          action,
          resource_type,
          resource_id,
          host(ip) AS ip,
          user_agent,
          justification,
          hash,
          prev_hash
        FROM audit_log
        ${whereSql}
        ORDER BY id ASC
        LIMIT ${limitParam}
      `;

      const result = await pool.query<EventRow>(sql, params);
      const items = result.rows;

      let nextAfterId: string | undefined;
      if (items.length === limit) {
        const lastItem = items[items.length - 1];
        nextAfterId = lastItem?.id;
      }

      return reply.send({ items, nextAfterId });
    },
  );

  // ---- GET /v1/verify --------------------------------------------------------

  app.get(
    "/v1/verify",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      verifyRunsCounter.inc();

      const BATCH_SIZE = 500;
      let afterId = BigInt(0);
      let done = false;

      async function* streamRows(): AsyncGenerator<AuditRow> {
        while (!done) {
          const result = await pool.query<AuditRow>(
            `SELECT
               id,
               ${DB_TS_EXPR} AS ts_str,
               actor_id,
               action,
               resource_type,
               resource_id,
               hash,
               prev_hash
             FROM audit_log
             WHERE id > $1
             ORDER BY id ASC
             LIMIT $2`,
            [afterId, BATCH_SIZE],
          );

          if (result.rows.length === 0) {
            done = true;
            return;
          }

          for (const row of result.rows) {
            yield row;
          }

          const lastRow = result.rows[result.rows.length - 1];
          if (lastRow !== undefined) {
            afterId = BigInt(String(lastRow.id));
          }

          if (result.rows.length < BATCH_SIZE) {
            done = true;
          }
        }
      }

      const verifyResult = await verifyChain(streamRows());
      return reply.send(verifyResult);
    },
  );

  // ---- POST /v1/export/daily -------------------------------------------------

  app.post(
    "/v1/export/daily",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = DailyExportSchema.safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({
          error: "Validation failed",
          issues: body.error.issues,
        });
      }

      const { date } = body.data;

      // Select the full UTC day's rows
      const from = `${date}T00:00:00.000Z`;
      const to = `${date}T23:59:59.999Z`;

      const result = await pool.query<ExportRow>(
        `SELECT
           id::text,
           ${DB_TS_EXPR} AS ts,
           actor_id,
           actor_role,
           action,
           resource_type,
           resource_id,
           host(ip) AS ip,
           user_agent,
           justification,
           hash,
           prev_hash
         FROM audit_log
         WHERE ts >= $1::timestamptz AND ts <= $2::timestamptz
         ORDER BY id ASC`,
        [from, to],
      );

      const rows = result.rows;
      const jsonl = rowsToJsonl(rows);
      const compressed = await gzipBuffer(jsonl);
      const key = buildExportKey(date);
      const bucket = process.env["WORM_BUCKET"] ?? "audit-worm";

      // Retention: 6 years from the export date
      const retainUntil = new Date(date);
      retainUntil.setFullYear(retainUntil.getFullYear() + 6);

      const s3 = new S3Client({
        endpoint: process.env["MINIO_ENDPOINT"] ?? "http://minio:9000",
        region: "us-east-1", // MinIO ignores region but SDK requires it
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env["MINIO_ACCESS_KEY"] ?? "",
          secretAccessKey: process.env["MINIO_SECRET_KEY"] ?? "",
        },
      });

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: compressed,
            ContentType: "application/gzip",
            ContentEncoding: "gzip",
            ObjectLockMode: "COMPLIANCE",
            ObjectLockRetainUntilDate: retainUntil,
          }),
        );
      } catch (err: unknown) {
        // Surface S3/MinIO errors cleanly — object lock may not be enabled
        const message =
          err instanceof Error ? err.message : String(err);
        return reply.status(502).send({
          error: "S3 upload failed",
          detail: message,
          key,
          count: rows.length,
          bytes: compressed.length,
        });
      }

      return reply.send({
        key,
        count: rows.length,
        bytes: compressed.length,
      });
    },
  );

  // ---- GET /healthz ----------------------------------------------------------

  app.get(
    "/healthz",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const dbOk = await checkDbHealth(pool);
      const kafkaOk = isKafkaConnected();
      const status = dbOk && kafkaOk ? "ok" : "degraded";

      return reply.status(dbOk ? 200 : 503).send({
        status,
        db: dbOk ? "ok" : "error",
        kafka: kafkaOk ? "ok" : "disconnected",
      });
    },
  );

  // ---- GET /metrics ----------------------------------------------------------

  app.get(
    "/metrics",
    async (_req: FastifyRequest, reply: FastifyReply) => {
      // Update queue depth gauge before scraping
      queueDepthGauge.set(queue.depth());

      const metrics = await registry.metrics();
      return reply
        .status(200)
        .header("Content-Type", registry.contentType)
        .send(metrics);
    },
  );

  return app;
}
