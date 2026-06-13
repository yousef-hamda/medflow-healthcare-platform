import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PolicyEngine } from './policy-engine';
import { AbacService } from './abac.service';
import { AbacGuard } from './abac.guard';
import { AbacController } from './abac.controller';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [AbacController],
  providers: [
    { provide: PolicyEngine, useFactory: () => new PolicyEngine() },
    AbacService,
    AbacGuard,
  ],
  exports: [PolicyEngine, AbacService, AbacGuard],
})
export class AbacModule {}
