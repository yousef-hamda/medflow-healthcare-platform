/**
 * src/db.ts — PostgreSQL pool + startup helpers.
 *
 * Uses the `pg` package directly (no ORM) with parameterized queries.
 * The audit_log table is append-only: UPDATE/DELETE/TRUNCATE are blocked at
 * the DB level by triggers in infra/docker/postgres/init-audit.sql.
 *
 * INET column handling
 * --------------------
 * PostgreSQL INET rejects empty strings and malformed addresses.  We validate
 * the ip field before insertion: if it's absent or doesn't look like a valid
 * IPv4/IPv6 address it is stored as NULL.
 */

import pg from "pg";
import { GENESIS_HASH, TS_EXPR } from "./chain.js";

// pg returns BIGINT (int8) as strings by default to avoid JS precision loss.
// We keep that behaviour — do NOT convert to number.

const { Pool } = pg;

let _pool: pg.Pool | null = null;

/**
 * Return the singleton Pool, initialising it on first call.
 * Must be called after the DATABASE_URL env var is set.
 */
export function getPool(): pg.Pool {
  if (_pool === null) {
    _pool = new Pool({
      connectionString: process.env["DATABASE_URL"],
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    _pool.on("error", (err) => {
      process.stderr.write(`pg pool error: ${String(err)}\n`);
    });
  }
  return _pool;
}

/**
 * Validate and normalise an IP string for INET insertion.
 *
 * Returns the original string if it looks like a valid IPv4 or IPv6 address,
 * otherwise returns null so the DB receives NULL (avoiding INET cast errors).
 *
 * We use simple regex heuristics rather than pulling in an IP library; for
 * audit purposes the exact validation at the DB gateway is authoritative.
 */
export function sanitiseIp(ip: string | undefined): string | null {
  if (ip === undefined || ip === "" || ip === null) return null;

  // Strip IPv6 zone identifier (e.g. "%eth0") before validation
  const stripped = ip.split("%")[0] ?? "";

  // IPv4
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(stripped);
  if (ipv4) {
    const parts = stripped.split(".");
    const valid = parts.every((p) => {
      const n = parseInt(p, 10);
      return n >= 0 && n <= 255;
    });
    if (valid) return stripped;
  }

  // IPv6 (basic: groups of hex digits separated by colons, with optional ::)
  const ipv6 = /^[0-9a-fA-F:]+$/.test(stripped) && stripped.includes(":");
  if (ipv6) return stripped;

  // IPv4-mapped IPv6: ::ffff:192.168.1.1
  const mapped = /^::ffff:\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(stripped);
  if (mapped) return stripped;

  return null;
}

/**
 * Load the hash of the most-recently inserted row from the DB.
 * Returns GENESIS_HASH when the table is empty (first run).
 *
 * Called once at service startup inside the write queue initialisation.
 */
export async function loadLastHash(pool: pg.Pool): Promise<string> {
  const result = await pool.query<{ hash: string }>(
    "SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1",
  );
  if (result.rows.length === 0) return GENESIS_HASH;
  const row = result.rows[0];
  if (row === undefined) return GENESIS_HASH;
  return row.hash;
}

/**
 * Insert one validated, hashed audit event into audit_log.
 *
 * @param pool      - pg Pool
 * @param ts        - Canonical ISO-8601 UTC string (used for both the
 *                    explicit ts value and for hash computation)
 * @param actorId   - actor_id column
 * @param actorRole - actor_role column
 * @param action    - action column
 * @param resourceType - resource_type column
 * @param resourceId   - resource_id column
 * @param ip        - Sanitised IP or null
 * @param userAgent - user_agent or null
 * @param justification - justification or null
 * @param hash      - Computed sha256 hash for this row
 * @param prevHash  - Hash of the previous row (or GENESIS_HASH)
 */
export async function insertAuditEvent(
  pool: pg.Pool,
  ts: string,
  actorId: string,
  actorRole: string,
  action: string,
  resourceType: string,
  resourceId: string,
  ip: string | null,
  userAgent: string | null,
  justification: string | null,
  hash: string,
  prevHash: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_log
       (ts, actor_id, actor_role, action, resource_type, resource_id,
        ip, user_agent, justification, hash, prev_hash)
     VALUES
       ($1::timestamptz, $2, $3, $4, $5, $6, $7::inet, $8, $9, $10, $11)`,
    [ts, actorId, actorRole, action, resourceType, resourceId,
     ip, userAgent, justification, hash, prevHash],
  );
}

/**
 * Check DB connectivity — used by /healthz.
 */
export async function checkDbHealth(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

// Re-export the TS_EXPR so route handlers can use it without importing chain
export { TS_EXPR };
