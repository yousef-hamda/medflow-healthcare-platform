import { describe, it, expect } from 'vitest';
import { narrowForPatientContext } from '../src/modules/fhir-proxy/patient-context';

describe('patient-context narrowing', () => {
  it('injects ?patient= on a compartment search', () => {
    const r = narrowForPatientContext(
      'Observation',
      new URLSearchParams({ code: '1234-5' }),
      'p1',
    );
    expect(r.forbidden).toBe(false);
    expect(r.targetPath).toContain('patient=p1');
    expect(r.targetPath).toContain('code=1234-5');
  });

  it('overwrites a spoofed cross-patient ?patient= value (forbidden)', () => {
    const r = narrowForPatientContext(
      'Observation',
      new URLSearchParams({ patient: 'p2' }),
      'p1',
    );
    expect(r.forbidden).toBe(true);
    expect(r.reason).toMatch(/cross-patient/i);
  });

  it('allows reading the context patient by id', () => {
    const r = narrowForPatientContext('Patient/p1', new URLSearchParams(), 'p1');
    expect(r.forbidden).toBe(false);
    expect(r.targetPath).toBe('Patient/p1');
  });

  it('forbids reading a different Patient by id', () => {
    const r = narrowForPatientContext('Patient/p2', new URLSearchParams(), 'p1');
    expect(r.forbidden).toBe(true);
  });

  it('pins a Patient search to the context patient _id', () => {
    const r = narrowForPatientContext('Patient', new URLSearchParams(), 'p1');
    expect(r.forbidden).toBe(false);
    expect(r.targetPath).toContain('_id=p1');
  });

  it('forbids a direct compartment instance read', () => {
    const r = narrowForPatientContext(
      'Observation/obs-1',
      new URLSearchParams(),
      'p1',
    );
    expect(r.forbidden).toBe(true);
  });
});
