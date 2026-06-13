import { describe, it, expect, beforeEach } from 'vitest';
import { AbacService } from '../src/modules/abac/abac.service';
import { PolicyEngine } from '../src/modules/abac/policy-engine';
import type { UsersService } from '../src/modules/users/users.service';
import type { Redis } from 'ioredis';
import type { TokenPayload } from '../src/modules/auth/token-signer';

/** In-memory Redis fake supporting the get/set(EX) used by AbacService. */
class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    _ex: 'EX',
    ttlSeconds: number,
  ): Promise<'OK'> {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return 'OK';
  }

  /** Test helper: force a key to be already expired. */
  expireNow(key: string): void {
    const entry = this.store.get(key);
    if (entry) entry.expiresAt = Date.now() - 1;
  }
}

const usersStub: Pick<
  UsersService,
  'getCareTeamPatientIds' | 'getLinkedPatientId'
> = {
  getCareTeamPatientIds: async () => [],
  getLinkedPatientId: async () => null,
};

const clinician: TokenPayload = {
  sub: 'u1',
  iss: 'test',
  scope: '',
  role: 'clinician',
};

describe('AbacService break-glass lifecycle', () => {
  let redis: FakeRedis;
  let service: AbacService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new AbacService(
      new PolicyEngine(),
      usersStub as UsersService,
      redis as unknown as Redis,
    );
  });

  it('grants a break-glass override and then allows the read', async () => {
    await service.grantBreakGlass('u1', 'pX', 'patient is coding in the ER bay now');
    expect(await service.hasActiveBreakGlass('u1', 'pX')).toBe(true);

    const decision = await service.evaluate(clinician, 'read', {
      resourceType: 'Observation',
      patientId: 'pX',
    });
    expect(decision.decision).toBe('allow');
    expect(decision.reason).toContain('break-glass');
  });

  it('denies once the break-glass grant has expired', async () => {
    await service.grantBreakGlass('u1', 'pX', 'emergency override justification');
    // Simulate the 1h TTL elapsing.
    redis.expireNow('abac:break-glass:u1:pX');

    expect(await service.hasActiveBreakGlass('u1', 'pX')).toBe(false);
    const decision = await service.evaluate(clinician, 'read', {
      resourceType: 'Observation',
      patientId: 'pX',
    });
    expect(decision.decision).toBe('deny');
  });
});
