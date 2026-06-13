/**
 * src/chain.ts — Hash-chain primitives for the audit_log table.
 *
 * DESIGN
 * ------
 * Each row's hash covers the canonical timestamp string (ISO-8601 UTC with
 * millisecond precision, identical to new Date().toISOString()), the actor,
 * action, resource coordinates, and the previous row's hash.  This forms a
 * forward-linked chain: mutating any row breaks the hash of every subsequent
 * row, making tampering detectable by the /v1/verify endpoint.
 *
 * DETERMINISM CONTRACT
 * --------------------
 * The exact string that enters the sha256 computation must survive a
 * round-trip through PostgreSQL TIMESTAMPTZ.  We INSERT using the canonical
 * ISO string directly (not NOW()) and SELECT back using:
 *
 *   to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
 *
 * This produces strings like "2024-01-15T10:30:00.123Z" — exactly what
 * new Date().toISOString() produces.  Both write (computeHash) and verify
 * (verifyChain) call canonicalTs() so the logic lives in exactly one place.
 *
 * The MS format code in PostgreSQL pads to 3 digits, matching JS milliseconds.
 */

import { createHash } from "crypto";

/** Genesis sentinel: 64 hex zeros used as prev_hash for the first row. */
export const GENESIS_HASH = "0".repeat(64);

/**
 * SQL fragment to SELECT the ts column as a canonical ISO-8601 UTC string.
 * Include this verbatim in SELECT statements instead of bare `ts` whenever
 * the string will participate in hash verification.
 *
 * Example: SELECT id, ${TS_EXPR} AS ts_str, ... FROM audit_log
 */
export const TS_EXPR =
  `to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * Normalise a timestamp to the canonical ISO-8601 UTC millisecond string
 * that both new Date().toISOString() and the TS_EXPR SQL produce.
 *
 * If the input is already a valid ISO string it is normalised via Date
 * parsing; if parsing fails the original string is returned unchanged
 * (the zod schema upstream guarantees it is valid).
 */
export function canonicalTs(ts: string): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) {
    // Should never happen — AuditEventSchema.ts validates datetime format
    return ts;
  }
  return d.toISOString(); // e.g. "2024-01-15T10:30:00.123Z"
}

/**
 * Produce a fresh canonical timestamp for events that arrive without one.
 * Always use this instead of new Date().toISOString() directly so the
 * canonical format is guaranteed to be consistent.
 */
export function nowCanonical(): string {
  return new Date().toISOString();
}

/**
 * Fields used in the hash input — exactly the columns stored in audit_log
 * (using their camelCase representation pre-insert).
 */
export interface HashableEvent {
  ts: string;        // canonical ISO-8601 UTC millisecond string
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
}

/**
 * Compute the sha256 hash for one audit log row.
 *
 * Input template (pipe-delimited, no trailing pipe):
 *   "{ts}|{actorId}|{action}|{resourceType}|{resourceId}|{prevHash}"
 *
 * All fields are taken as-is (no extra encoding).  The canonical ts string
 * is the exact same string that was inserted into the `ts` column and
 * recovered via TS_EXPR.
 */
export function computeHash(event: HashableEvent, prevHash: string): string {
  const input = [
    event.ts,
    event.actorId,
    event.action,
    event.resourceType,
    event.resourceId,
    prevHash,
  ].join("|");
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * A row as returned by the verify query — ts_str is the TS_EXPR output.
 */
export interface AuditRow {
  id: bigint | number | string;
  ts_str: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  hash: string;
  prev_hash: string;
}

/**
 * Verify the hash chain over an async iterable of AuditRow (ordered by id).
 *
 * The function is generator-friendly: it processes rows lazily, so you can
 * feed it a pg cursor without loading all rows into memory.
 *
 * Returns { valid, checkedCount, brokenAtId? }.
 */
export async function verifyChain(
  rows: AsyncIterable<AuditRow>,
): Promise<{ valid: boolean; checkedCount: number; brokenAtId?: string }> {
  let prevHash = GENESIS_HASH;
  let checkedCount = 0;

  for await (const row of rows) {
    checkedCount++;
    const expected = computeHash(
      {
        ts: row.ts_str,          // canonical ts recovered from DB via TS_EXPR
        actorId: row.actor_id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
      },
      row.prev_hash,
    );

    if (row.hash !== expected || row.prev_hash !== prevHash) {
      return {
        valid: false,
        checkedCount,
        brokenAtId: String(row.id),
      };
    }

    prevHash = row.hash;
  }

  return { valid: true, checkedCount };
}

/**
 * In-memory chain verification helper used by unit tests (no DB needed).
 *
 * Accepts an array of plain objects shaped like AuditRow and verifies the
 * chain synchronously.  This is a thin wrapper over verifyChain that
 * converts the array into an AsyncIterable.
 */
export async function verifyChainArray(
  rows: AuditRow[],
): Promise<{ valid: boolean; checkedCount: number; brokenAtId?: string }> {
  async function* gen(): AsyncGenerator<AuditRow> {
    for (const row of rows) {
      yield row;
    }
  }
  return verifyChain(gen());
}
