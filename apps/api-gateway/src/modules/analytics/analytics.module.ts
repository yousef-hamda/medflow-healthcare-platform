import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { UsersService } from '../users/users.service';
import { REDIS_TOKEN } from '../rate-limit/redis.provider';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AnalyticsController],
  providers: [
    {
      provide: AnalyticsService,
      inject: [ConfigService, UsersService, REDIS_TOKEN],
      useFactory: (
        config: ConfigService,
        users: UsersService,
        redis: Redis,
      ): AnalyticsService => new AnalyticsService(config, users, redis),
    },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
