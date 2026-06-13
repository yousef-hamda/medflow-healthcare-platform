import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from '../rate-limit/redis.provider';
import { UsersService } from '../users/users.service';
import { PolicyEngine } from './policy-engine';
import type {
  PolicyAction,
  PolicyDecision,
  ResourceAttributes,
  SubjectAttributes,
} from './policy.types';
import type { TokenPayload } from '../auth/token-signer';

/** Break-glass grants live in Redis for exactly one hour. */
export const BREAK_GLASS_TTL_S = 3600;
const breakGlassKey = (userId: string, patientId: string): string =>
  `abac:break-glass:${userId}:${patientId}`;

@Injectable()
export class AbacService {
  constructor(
    private readonly engine: PolicyEngine,
    private readonly usersService: UsersService,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  /** Assembles subject attributes for the policy engine from token + DB + Redis. */
  async buildSubjectAttributes(
    user: TokenPayload,
    patientId?: string,
  ): Promise<SubjectAttributes> {
    const [careTeamPatientIds, linkedPatientId] = await Promise.all([
      this.usersService.getCareTeamPatientIds(user.sub),
      this.usersService.getLinkedPatientId(user.sub),
    ]);

    const breakGlassPatientIds: string[] = [];
    if (patientId && (await this.hasActiveBreakGlass(user.sub, patientId))) {
      breakGlassPatientIds.push(patientId);
    }

    return {
      userId: user.sub,
      role: user.role,
      careTeamPatientIds,
      linkedPatientId: linkedPatientId ?? undefined,
      breakGlassPatientIds,
    };
  }

  async evaluate(
    user: TokenPayload,
    action: PolicyAction,
    resource: ResourceAttributes,
  ): Promise<PolicyDecision> {
    const subject = await this.buildSubjectAttributes(user, resource.patientId);
    return this.engine.evaluate(subject, action, resource);
  }

  // ── Break-glass grants ─────────────────────────────────────────────────────

  async hasActiveBreakGlass(
    userId: string,
    patientId: string,
  ): Promise<boolean> {
    const value = await this.redis.get(breakGlassKey(userId, patientId));
    return value !== null;
  }

  /**
   * Grants a 1-hour break-glass override for a patient. Caller (controller)
   * is responsible for emitting the CRITICAL audit event with the justification.
   */
  async grantBreakGlass(
    userId: string,
    patientId: string,
    justification: string,
  ): Promise<{ patientId: string; expiresAt: string }> {
    const expiresAt = new Date(Date.now() + BREAK_GLASS_TTL_S * 1000);
    await this.redis.set(
      breakGlassKey(userId, patientId),
      JSON.stringify({ justification, grantedAt: new Date().toISOString() }),
      'EX',
      BREAK_GLASS_TTL_S,
    );
    return { patientId, expiresAt: expiresAt.toISOString() };
  }
}
