import { describe, it, expect } from 'vitest';
import { PolicyEngine } from '../src/modules/abac/policy-engine';
import type { SubjectAttributes } from '../src/modules/abac/policy.types';

const base = (over: Partial<SubjectAttributes>): SubjectAttributes => ({
  userId: 'u1',
  role: 'clinician',
  careTeamPatientIds: [],
  linkedPatientId: undefined,
  breakGlassPatientIds: [],
  ...over,
});

describe('PolicyEngine truth table', () => {
  const engine = new PolicyEngine();

  it('allows a clinician reading a care-team patient', () => {
    const d = engine.evaluate(
      base({ role: 'clinician', careTeamPatientIds: ['p1'] }),
      'read',
      { resourceType: 'Observation', patientId: 'p1' },
    );
    expect(d.decision).toBe('allow');
    expect(d.reason).toContain('clinician-care-team-overlap');
  });

  it('denies a clinician reading a non-care-team patient', () => {
    const d = engine.evaluate(
      base({ role: 'clinician', careTeamPatientIds: ['p1'] }),
      'read',
      { resourceType: 'Observation', patientId: 'p2' },
    );
    expect(d.decision).toBe('deny');
  });

  it('allows a patient reading their own resource', () => {
    const d = engine.evaluate(
      base({ role: 'patient', linkedPatientId: 'p9' }),
      'read',
      { resourceType: 'Condition', patientId: 'p9' },
    );
    expect(d.decision).toBe('allow');
    expect(d.reason).toContain('patient-self-access');
  });

  it('denies a patient reading another patient resource', () => {
    const d = engine.evaluate(
      base({ role: 'patient', linkedPatientId: 'p9' }),
      'read',
      { resourceType: 'Condition', patientId: 'p8' },
    );
    expect(d.decision).toBe('deny');
  });

  it('allows admin to read AuditEvent', () => {
    const d = engine.evaluate(base({ role: 'admin' }), 'audit-read', {
      resourceType: 'AuditEvent',
    });
    expect(d.decision).toBe('allow');
    expect(d.reason).toContain('admin-audit-read');
  });

  it('denies a clinician reading AuditEvent', () => {
    const d = engine.evaluate(base({ role: 'clinician' }), 'audit-read', {
      resourceType: 'AuditEvent',
    });
    expect(d.decision).toBe('deny');
  });

  it('allows access via an active break-glass grant outside the care team', () => {
    const d = engine.evaluate(
      base({ role: 'clinician', careTeamPatientIds: [], breakGlassPatientIds: ['pX'] }),
      'read',
      { resourceType: 'Observation', patientId: 'pX' },
    );
    expect(d.decision).toBe('allow');
    expect(d.reason).toContain('break-glass');
  });

  it('denies once the break-glass grant has expired (no longer in subject attrs)', () => {
    // Expiry is modelled by the grant dropping out of breakGlassPatientIds.
    const d = engine.evaluate(
      base({ role: 'clinician', careTeamPatientIds: [], breakGlassPatientIds: [] }),
      'read',
      { resourceType: 'Observation', patientId: 'pX' },
    );
    expect(d.decision).toBe('deny');
  });

  it('defaults to deny when no policy matches', () => {
    const d = engine.evaluate(base({ role: 'guest' }), 'read', {
      resourceType: 'Observation',
      patientId: 'p1',
    });
    expect(d.decision).toBe('deny');
  });
});
