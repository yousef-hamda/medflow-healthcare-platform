import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AuditService } from './audit.service';
import { AuditInterceptor } from './audit.interceptor';

/**
 * Global audit pipeline. AuditService is exported so other modules (e.g. the
 * ABAC break-glass controller) can emit explicit CRITICAL events; the
 * interceptor is registered app-wide via APP_INTERCEPTOR.
 */
@Global()
@Module({
  providers: [
    {
      provide: AuditService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): AuditService =>
        new AuditService(config),
    },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
  exports: [AuditService],
})
export class AuditModule {}
