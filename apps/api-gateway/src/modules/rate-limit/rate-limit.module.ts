import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorage } from '@nestjs/throttler';
import { redisProvider, REDIS_TOKEN } from './redis.provider';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { OAuthThrottlerGuard } from './oauth-throttler.guard';

/**
 * Owns the single shared Redis client + Redis-backed throttler storage.
 *
 * Kept separate from RateLimitModule so the async ThrottlerModule factory can
 * import it (to inject the storage) without a circular dependency. Both this
 * module and RateLimitModule are global, so REDIS_TOKEN is injectable anywhere.
 */
@Global()
@Module({
  providers: [redisProvider, RedisThrottlerStorage],
  exports: [RedisThrottlerStorage, REDIS_TOKEN],
})
export class RateLimitInternalModule {}

/**
 * Rate-limiting facade.
 *
 * Throttler buckets are keyed per OAuth client (see OAuthThrottlerGuard) and
 * backed by Redis so limits hold across horizontally-scaled gateway replicas:
 * a 10 req/s burst window plus a 100 req/min sustained window. The guard is
 * registered app-wide via APP_GUARD.
 */
@Global()
@Module({
  imports: [
    RateLimitInternalModule,
    ThrottlerModule.forRootAsync({
      imports: [RateLimitInternalModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: ThrottlerStorage) => ({
        throttlers: [
          { name: 'burst', ttl: 1_000, limit: 10 },
          { name: 'sustained', ttl: 60_000, limit: 100 },
        ],
        storage,
      }),
    }),
  ],
  providers: [
    OAuthThrottlerGuard,
    { provide: APP_GUARD, useClass: OAuthThrottlerGuard },
  ],
  exports: [
    REDIS_TOKEN,
    RedisThrottlerStorage,
    OAuthThrottlerGuard,
    ThrottlerModule,
    RateLimitInternalModule,
  ],
})
export class RateLimitModule {}
