/**
 * Redis-backed ThrottlerStorage so rate-limit counters are shared across
 * every gateway node (in-memory storage would only limit per-process).
 *
 * Matches the @nestjs/throttler 5.1.2 contract:
 *   increment(key, ttl) → { totalHits, timeToExpire }
 *
 * Uses INCR + PEXPIRE: the first hit in a window sets the TTL; subsequent hits
 * just bump the counter and read the remaining TTL.
 */

import { Inject, Injectable } from '@nestjs/common';
import type {
  ThrottlerStorage,
  ThrottlerStorageRecord,
} from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from './redis.provider';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_TOKEN) private readonly redis: Redis) {}

  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${key}`;
    const totalHits = await this.redis.incr(hitKey);
    if (totalHits === 1) {
      // throttler v5 supplies ttl in milliseconds — use PEXPIRE/PTTL to match.
      await this.redis.pexpire(hitKey, ttl);
    }
    const remaining = await this.redis.pttl(hitKey);
    return {
      totalHits,
      timeToExpire: remaining >= 0 ? remaining : ttl,
    };
  }
}
