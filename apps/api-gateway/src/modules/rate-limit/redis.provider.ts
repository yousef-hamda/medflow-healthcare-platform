/**
 * Shared ioredis client provider.
 *
 * A single Redis connection is reused across the gateway for:
 *   - refresh-token + authorization-code persistence (auth)
 *   - share-token revocation lists (share)
 *   - ABAC break-glass grants (abac)
 *   - ML risk-score worklist cache (analytics)
 *   - throttler storage (rate-limit)
 *
 * The connection is lazily created from REDIS_URL and exported via REDIS_TOKEN.
 */

import type { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { type Redis } from 'ioredis';

export const REDIS_TOKEN = 'REDIS_CLIENT';

export const redisProvider: Provider = {
  provide: REDIS_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService): Redis => {
    const url = config.getOrThrow<string>('REDIS_URL');
    return new IORedis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  },
};
