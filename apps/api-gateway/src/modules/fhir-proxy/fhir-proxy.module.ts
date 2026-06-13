import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { FhirProxyService } from './fhir-proxy.service';
import { FhirProxyController } from './fhir-proxy.controller';

@Module({
  imports: [AuthModule],
  controllers: [FhirProxyController],
  providers: [
    {
      provide: FhirProxyService,
      inject: [ConfigService],
      useFactory: (config: ConfigService): FhirProxyService =>
        new FhirProxyService(config),
    },
  ],
  exports: [FhirProxyService],
})
export class FhirProxyModule {}
