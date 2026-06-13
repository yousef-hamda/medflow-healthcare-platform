/**
 * Postgres persistence layer for CDS Hooks feedback.
 *
 * Uses pg 8.12.0 (plain Pool, no ORM).
 *
 * Table DDL (created on startup if absent):
 *
 *   CREATE TABLE IF NOT EXISTS cds_feedback (
 *     id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *     service_id   TEXT        NOT NULL,
 *     card_uuid    TEXT        NOT NULL,
 *     outcome      TEXT        NOT NULL,
 *     outcome_ts   TIMESTAMPTZ NOT NULL,
 *     override_reason TEXT,
 *     payload      JSONB       NOT NULL,
 *     created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 */

import pg from 'pg';
import { logger } from '../logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

/** Returns the shared pool, creating it on first call. */
export function getPool(databaseUrl: string): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl, max: 10 });
    pool.on('error', (err: Error) => {
      logger.error({ err: err.message }, 'Postgres pool idle error');
    });
  }
  return pool;
}

/**
 * Creates the cds_feedback table if it does not already exist.
 * Called once during server startup.
 */
export async function ensureFeedbackTable(databaseUrl: string): Promise<void> {
  const client = await getPool(databaseUrl).connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cds_feedback (
        id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        service_id     TEXT        NOT NULL,
        card_uuid      TEXT        NOT NULL,
        outcome        TEXT        NOT NULL,
        outcome_ts     TIMESTAMPTZ NOT NULL,
        override_reason TEXT,
        payload        JSONB       NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS cds_feedback_service_id_idx ON cds_feedback (service_id);
      CREATE INDEX IF NOT EXISTS cds_feedback_card_uuid_idx  ON cds_feedback (card_uuid);
    `);
    logger.info('cds_feedback table ready');
  } finally {
    client.release();
  }
}

export interface FeedbackRow {
  serviceId: string;
  cardUuid: string;
  outcome: string;
  outcomeTs: string;
  overrideReason?: string;
  payload: Record<string, unknown>;
}

/**
 * Persists a batch of feedback rows within a single transaction.
 */
export async function persistFeedback(
  databaseUrl: string,
  rows: FeedbackRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const client = await getPool(databaseUrl).connect();
  try {
    await client.query('BEGIN');

    for (const row of rows) {
      await client.query(
        `INSERT INTO cds_feedback
           (service_id, card_uuid, outcome, outcome_ts, override_reason, payload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          row.serviceId,
          row.cardUuid,
          row.outcome,
          row.outcomeTs,
          row.overrideReason ?? null,
          JSON.stringify(row.payload),
        ],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Closes the connection pool — call during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
