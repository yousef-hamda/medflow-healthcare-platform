/**
 * Redis ring buffer — pure logic abstracted over a minimal RedisBuffer interface.
 *
 * Layout per room:
 *   - List key  : `rb:{room}`   — JSON-encoded BufferEntry[], newest at index 0 (LPUSH).
 *   - Counter key: `rb:{room}:seq` — monotonic event id (INCR).
 *
 * The list is capped at MAX_ENTRIES via LTRIM after every LPUSH.
 *
 * Replay returns events whose id is strictly greater than `lastEventId`, in
 * chronological order (oldest-first), so the client receives them in
 * emission order.
 */

export const MAX_ENTRIES = 1000;

export interface BufferEntry {
  id: number;
  event: string;
  payload: unknown;
  room: string;
  ts: number; // epoch ms
}

/**
 * Minimal Redis interface the ring buffer needs.
 * Production: ioredis client; tests: in-memory mock.
 */
export interface RedisBuffer {
  /**
   * Atomically increment and return the new value of `key`.
   * Equivalent to Redis INCR.
   */
  incr(key: string): Promise<number>;

  /**
   * Prepend `value` to the list at `key`.
   * Equivalent to Redis LPUSH (single value variant).
   */
  lpush(key: string, value: string): Promise<number>;

  /**
   * Trim the list at `key` to indices [start, stop] (inclusive).
   * Equivalent to Redis LTRIM.
   */
  ltrim(key: string, start: number, stop: number): Promise<void>;

  /**
   * Return all elements of the list at `key` (index 0 to -1).
   * Returns [] when the key does not exist.
   */
  lrange(key: string, start: number, stop: number): Promise<string[]>;
}

/** Derive the Redis keys for a given room. */
function keys(room: string) {
  return {
    list: `rb:${room}`,
    seq: `rb:${room}:seq`,
  };
}

/**
 * Append an event to the ring buffer for `room`.
 *
 * Guarantees:
 *  - Monotonically increasing `id` per room (via INCR on the seq key).
 *  - List never exceeds MAX_ENTRIES entries (LTRIM after LPUSH).
 *
 * Returns the assigned event id so callers can surface it.
 */
export async function pushToBuffer(
  redis: RedisBuffer,
  room: string,
  event: string,
  payload: unknown,
): Promise<number> {
  const { list, seq } = keys(room);
  const id = await redis.incr(seq);
  const entry: BufferEntry = { id, event, payload, room, ts: Date.now() };
  await redis.lpush(list, JSON.stringify(entry));
  await redis.ltrim(list, 0, MAX_ENTRIES - 1);
  return id;
}

/**
 * Replay events that occurred after `lastEventId`.
 *
 * Returns events in ascending id order (chronological), ready to send to the
 * reconnecting client. If `lastEventId` is 0 (or undefined), all stored events
 * are returned.
 *
 * Implementation: the list is stored newest-first (LPUSH), so we read all
 * entries, filter by id > lastEventId, and reverse to get oldest-first order.
 */
export async function replayFromBuffer(
  redis: RedisBuffer,
  room: string,
  lastEventId: number,
): Promise<BufferEntry[]> {
  const { list } = keys(room);
  const raw = await redis.lrange(list, 0, -1);

  const entries: BufferEntry[] = raw
    .map((s) => {
      try {
        return JSON.parse(s) as BufferEntry;
      } catch {
        return null;
      }
    })
    .filter((e): e is BufferEntry => e !== null && e.id > lastEventId);

  // Sort ascending (oldest first) for correct replay order
  entries.sort((a, b) => a.id - b.id);
  return entries;
}
