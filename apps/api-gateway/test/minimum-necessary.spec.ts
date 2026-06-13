import { describe, it, expect } from 'vitest';
import { applyMinimumNecessary } from '../src/modules/fhir-proxy/minimum-necessary';
import { parseSmartScopes } from '@medflow/shared-types';

const scopes = (s: string) => parseSmartScopes(s).resourceScopes;

const patient = {
  resourceType: 'Patient',
  id: 'p1',
  gender: 'female',
  identifier: [{ system: 'mrn', value: 'MRN-123' }],
  telecom: [{ system: 'phone', value: '555-1234' }],
  address: [{ city: 'Springfield' }],
};

describe('minimum-necessary masking', () => {
  it('strips identifier/telecom/address without a contact scope', () => {
    const masked = applyMinimumNecessary(patient, scopes('patient/Patient.read')) as Record<
      string,
      unknown
    >;
    expect(masked.identifier).toBeUndefined();
    expect(masked.telecom).toBeUndefined();
    expect(masked.address).toBeUndefined();
    expect(masked.gender).toBe('female');
  });

  it('keeps contact fields when scope grants .full', () => {
    const masked = applyMinimumNecessary(
      patient,
      scopes('user/Patient.full'),
    ) as Record<string, unknown>;
    expect(masked.identifier).toBeDefined();
    expect(masked.telecom).toBeDefined();
    expect(masked.address).toBeDefined();
  });

  it('masks every entry of a searchset Bundle', () => {
    const bundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      entry: [{ resource: patient }, { resource: { ...patient, id: 'p2' } }],
    };
    const masked = applyMinimumNecessary(bundle, scopes('patient/Patient.read')) as {
      entry: Array<{ resource: Record<string, unknown> }>;
    };
    for (const e of masked.entry) {
      expect(e.resource.identifier).toBeUndefined();
      expect(e.resource.telecom).toBeUndefined();
      expect(e.resource.address).toBeUndefined();
    }
  });

  it('does not mutate the original payload', () => {
    applyMinimumNecessary(patient, scopes('patient/Patient.read'));
    expect(patient.identifier).toBeDefined();
  });
});
