import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditEventSchema, type AuditEvent } from '@medflow/shared-types';

/**
 * Fire-and-forget audit pipeline.
 *
 * Events are pushed onto a bounded in-memory queue and flushed in batches to
 * the audit-service over HTTP. The pipeline must NEVER block or fail a request:
 *   - On overflow we drop the OLDEST event and warn (most recent events matter
 *     most for live security review; the queue is a buffer, not the system of
 *     record — the audit-service owns durability).
 *   - On flush error we re-buffer (bounded) and retry on the next tick.
 */

export type FetchFn = typeof fetch;

const MAX_QUEUE = 10_000;
const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 2_000;

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private readonly queue: AuditEvent[] = [];
  private readonly endpoint: string;
  private droppedSinceWarn = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    config: ConfigService,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.endpoint = config.getOrThrow<string>('AUDIT_SERVICE_URL');
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    // Do not keep the event loop alive solely for the audit timer.
    this.timer.unref?.();
  }

  /**
   * Enqueue an audit event. Validates against the shared schema and silently
   * drops malformed events (logging a warning) — never throws to the caller.
   */
  enqueue(event: AuditEvent): void {
    const parsed = AuditEventSchema.safeParse(event);
    if (!parsed.success) {
      this.logger.warn(
        `Dropping malformed audit event: ${parsed.error.message}`,
      );
      return;
    }

    if (this.queue.length >= MAX_QUEUE) {
      this.queue.shift(); // drop oldest
      this.droppedSinceWarn++;
      if (this.droppedSinceWarn === 1 || this.droppedSinceWarn % 1000 === 0) {
        this.logger.warn(
          `Audit queue overflow — dropped ${this.droppedSinceWarn} oldest event(s)`,
        );
      }
    }
    this.queue.push(parsed.data);
  }

  /** Flush up to BATCH_SIZE events. Errors re-buffer; never throws. */
  async flush(): Promise<void> {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, BATCH_SIZE);
    try {
      const res = await this.fetchFn(`${this.endpoint}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: batch }),
      });
      if (!res.ok) {
        throw new Error(`audit-service returned ${res.status}`);
      }
    } catch (err) {
      // Re-buffer at the front (bounded) so we retry next tick.
      const room = MAX_QUEUE - this.queue.length;
      if (room > 0) {
        this.queue.unshift(...batch.slice(0, room));
      }
      this.logger.warn(
        `Audit flush failed, re-buffered ${Math.min(batch.length, Math.max(room, 0))} event(s): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Test/diagnostic accessor for current queue depth. */
  get queueDepth(): number {
    return this.queue.length;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
