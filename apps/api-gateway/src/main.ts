// OTel MUST be imported first — before any NestJS or application imports
// so instrumentation can patch HTTP, pg, ioredis, etc. at load time.
import './telemetry';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Use pino as the Nest logger
  app.useLogger(app.get(Logger));

  // Global validation pipe — class-validator on all DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger / OpenAPI at /docs
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MedFlow API Gateway')
    .setDescription(
      'OAuth2/OIDC issuer, FHIR R4 proxy, ML inference, clinical analytics, and workflow APIs',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addOAuth2({
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: '/oauth/authorize',
          tokenUrl: '/oauth/token',
          scopes: {
            openid: 'OpenID Connect',
            fhirUser: 'FHIR user identity',
            'launch/patient': 'Patient launch context',
            offline_access: 'Refresh token',
            'patient/Patient.read': 'Read patient data',
            'user/Patient.full': 'Full patient data (PHI unmasked)',
          },
        },
      },
    })
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = parseInt(process.env['HTTP_PORT'] ?? '4000', 10);
  await app.listen(port);
}

void bootstrap();
