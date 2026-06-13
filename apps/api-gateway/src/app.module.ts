import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { LoggerModule } from 'nestjs-pino';
import { buildPinoRedactPaths } from '@medflow/shared-types';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AbacModule } from './modules/abac/abac.module';
import { VaultModule } from './modules/vault/vault.module';
import { FhirProxyModule } from './modules/fhir-proxy/fhir-proxy.module';
import { MlModule } from './modules/ml/ml.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ShareModule } from './modules/share/share.module';
import { AuditModule } from './modules/audit/audit.module';
import { RateLimitModule } from './modules/rate-limit/rate-limit.module';
import { HealthModule } from './modules/health/health.module';
import { GraphqlModule } from './modules/graphql/graphql.module';

import { User } from './modules/users/entities/user.entity';
import { Clinician } from './modules/users/entities/clinician.entity';
import { PatientLink } from './modules/users/entities/patient-link.entity';
import { CareTeam } from './modules/users/entities/care-team.entity';
import { CareTeamMembership } from './modules/users/entities/care-team-membership.entity';
import { MessageThread } from './modules/messaging/entities/message-thread.entity';
import { Message } from './modules/messaging/entities/message.entity';
import { Appointment } from './modules/appointments/entities/appointment.entity';
import { ShareToken } from './modules/share/entities/share-token.entity';

@Module({
  imports: [
    // ── Config ──────────────────────────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    // ── Pino logger with PHI redaction ───────────────────────────────────
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (_config: ConfigService) => ({
        pinoHttp: {
          level:
            process.env['NODE_ENV'] === 'production' ? 'info' : 'debug',
          redact: {
            paths: [
              ...buildPinoRedactPaths(['req.body', 'res.body']),
              // Message body paths — must never appear in logs
              'req.body.body',
              'req.body.messageBody',
              '*.body',
              '*.messageBody',
            ],
            censor: '[REDACTED]',
          },
          transport:
            process.env['NODE_ENV'] !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
        },
      }),
    }),

    // ── TypeORM ─────────────────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.getOrThrow<string>('DATABASE_URL'),
        entities: [
          User,
          Clinician,
          PatientLink,
          CareTeam,
          CareTeamMembership,
          MessageThread,
          Message,
          Appointment,
          ShareToken,
        ],
        migrations: ['dist/migrations/*.js'],
        migrationsRun: true,
        synchronize: false,
        logging: process.env['NODE_ENV'] !== 'production',
      }),
    }),

    // ── GraphQL ─────────────────────────────────────────────────────────
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: true,
      sortSchema: true,
      playground: process.env['NODE_ENV'] !== 'production',
      context: ({ req }: { req: unknown }) => ({ req }),
    }),

    // Feature modules
    AuthModule,
    UsersModule,
    AbacModule,
    VaultModule,
    FhirProxyModule,
    MlModule,
    AnalyticsModule,
    MessagingModule,
    AppointmentsModule,
    ShareModule,
    AuditModule,
    RateLimitModule,
    HealthModule,
    GraphqlModule,
  ],
})
export class AppModule {}
