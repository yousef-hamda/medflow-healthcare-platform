import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from './health.controller';
import { MetricsService } from './metrics.service';
import { MetricsInterceptor } from './metrics.interceptor';

@Global()
@Module({
  controllers: [HealthController],
  providers: [
    MetricsService,
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
  exports: [MetricsService],
})
export class HealthModule {}
