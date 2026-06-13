/**
 * src/queue.ts — In-process FIFO write queue that serialises all audit log
 * insertions (from both the HTTP route and the Kafka consumer) so the hash
 * chain is never computed concurrently.
 *
 * Invariants:
 *  - Only one insertion runs at a time (FIFO, no concurrency).
 *  - prevHash is maintained in memory; it is loaded from the DB on startup.
 *  - Callers await enqueue() to completion — the 202 response is sent AFTER
 *    the row has been durably written (simple and correct over pure fire-and-forget).
 *
 * The queue is a linked-list of Promises: each enqueue() call chains onto the
 * tail of the previous one.  This is a classic async mutex pattern.
 */

import type pg from "pg";
import type { AuditEvent } from "@medflow/shared-types";
import { computeHash, canonicalTs, nowCanonical } from "./chain.js";
import { loadLastHash, insertAuditEvent, sanitiseIp } from "./db.js";

export interface WriteQueue {
  /**
   * Enqueue one validated AuditEvent for insertion.
   * Resolves when the row has been committed to the DB.
   */
  enqueue(event: AuditEvent): Promise<void>;

  /** Current number of items waiting in queue (for /metrics gauge). */
  depth(): number;
}

/**
 * Initialise the write queue.  Loads the last hash from the DB so the chain
 * continues correctly after a service restart.
 */
export async function createWriteQueue(pool: pg.Pool): Promise<WriteQueue> {
  let prevHash = await loadLastHash(pool);
  let tail: Promise<void> = Promise.resolve();
  let _depth = 0;

  function enqueue(event: AuditEvent): Promise<void> {
    _depth++;
    // Chain the new write onto the current tail so writes are strictly serial
    const next = tail.then(async () => {
      try {
        await writeOne(pool, event, prevHash, (newHash: string) => {
          prevHash = newHash;
        });
      } finally {
        _depth--;
      }
    });
    tail = next.catch(() => {
      // Prevent unhandled rejection from propagating into the shared tail;
      // individual callers receive the rejection from `next` directly.
    });
    return next;
  }

  function depth(): number {
    return _depth;
  }

  return { enqueue, depth };
}

/**
 * Write a single validated event to the DB.
 * Called exclusively from inside the FIFO queue, so it runs serially.
 *
 * @param onHashCommitted - Callback invoked with the new hash once the row is
 *                          durably written; the queue updates prevHash here.
 */
async function writeOne(
  pool: pg.Pool,
  event: AuditEvent,
  prevHash: string,
  onHashCommitted: (hash: string) => void,
): Promise<void> {
  // Canonical timestamp: use provided ts normalised to UTC ms-precision, or now()
  const ts = event.ts !== undefined ? canonicalTs(event.ts) : nowCanonical();

  const hash = computeHash(
    {
      ts,
      actorId: event.actorId,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
    },
    prevHash,
  );

  const ip = sanitiseIp(event.ip);
  const userAgent = event.userAgent ?? null;
  const justification = event.justification ?? null;

  await insertAuditEvent(
    pool,
    ts,
    event.actorId,
    event.actorRole,
    event.action,
    event.resourceType,
    event.resourceId,
    ip,
    userAgent,
    justification,
    hash,
    prevHash,
  );

  // Update in-memory chain state only after successful DB commit
  onHashCommitted(hash);
}
