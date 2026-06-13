import { describe, it, expect, vi, afterEach } from 'vitest';
import { AuditService } from '../src/modules/audit/audit.service';
import type { ConfigService } from '@nestjs/config';
import type { AuditEvent } from '@medflow/shared-types';

const config = {
  getOrThrow: (key: string) => {
    if (key === 'AUDIT_SERVICE_URL') return 'http://audit-service:8095';
    throw new Error(`unexpected key ${key}`);
  },
} as unknown as ConfigService;

const event = (i: number): AuditEvent => ({
  actorId: `actor-${i}`,
  actorRole: 'clinician',
  action: 'GET /fhir/Observation',
  resourceType: 'Observation',
  resourceId: String(i),
});

describe('AuditService', () => {
  let svc: AuditService | undefined;

  afterEach(async () => {
    if (svc) await svc.onModuleDestroy();
    svc = undefined;
    vi.restoreAllMocks();
  });

  it('drops the oldest event on overflow and never throws', () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    svc = new AuditService(config, fetchFn as unknown as typeof fetch);

    const MAX = 10_000;
    // Enqueue MAX + 5 — the first 5 (oldest) should be dropped.
    for (let i = 0; i < MAX + 5; i++) {
      expect(() => svc!.enqueue(event(i))).not.toThrow();
    }
    expect(svc.queueDepth).toBe(MAX);
  });

  it('silently drops malformed events', () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    svc = new AuditService(config, fetchFn as unknown as typeof fetch);
    // Missing required actorId/action → schema rejects.
    svc.enqueue({ resourceType: 'X' } as unknown as AuditEvent);
    expect(svc.queueDepth).toBe(0);
  });

  it('flushes batches to the audit service', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 200 }));
    svc = new AuditService(config, fetchFn as unknown as typeof fetch);
    svc.enqueue(event(1));
    svc.enqueue(event(2));
    await svc.flush();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(svc.queueDepth).toBe(0);
  });

  it('re-buffers events when the flush fails (never loses on transient error)', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    svc = new AuditService(config, fetchFn as unknown as typeof fetch);
    svc.enqueue(event(1));
    await svc.flush();
    // Event re-buffered for retry rather than dropped.
    expect(svc.queueDepth).toBe(1);
  });
});
