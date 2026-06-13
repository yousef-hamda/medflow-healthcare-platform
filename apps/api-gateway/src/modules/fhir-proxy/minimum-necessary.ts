/**
 * Minimum-necessary masking.
 *
 * Unless the caller's scopes include unmasked contact access, we strip the
 * direct-identifier elements (`identifier`, `telecom`, `address`) from any FHIR
 * resource — including every entry of a searchset Bundle. This implements the
 * HIPAA minimum-necessary principle at the proxy boundary.
 *
 * Unmasking requires EITHER:
 *   - a `.full` / wildcard scope on the resource type (see hasFullFieldAccess), OR
 *   - an explicit contact scope: `user/Patient.phi` or `patient/Patient.contact`
 *     style grant expressed as resourceType `phi` or `contact` with `.read`.
 */

import {
  hasFullFieldAccess,
  type SmartScope,
} from '@medflow/shared-types';

/** Direct-identifier elements removed under minimum-necessary masking. */
export const MASKED_FIELDS = ['identifier', 'telecom', 'address'] as const;

/**
 * True when the granted scopes permit unmasked contact/identifier fields for
 * the given resource type.
 */
export function canSeeContactFields(
  grantedScopes: readonly SmartScope[],
  resourceType: string,
): boolean {
  if (hasFullFieldAccess(grantedScopes, resourceType)) return true;
  // Pseudo-resource scopes `phi` / `contact` act as an explicit contact grant.
  return grantedScopes.some(
    (s) =>
      (s.resourceType === 'phi' || s.resourceType === 'contact') &&
      (s.permission === 'read' || s.permission === '*' || s.permission === 'full'),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Returns a shallow-masked copy of a single resource. */
function maskResource(
  resource: Record<string, unknown>,
): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...resource };
  for (const field of MASKED_FIELDS) {
    if (field in copy) delete copy[field];
  }
  return copy;
}

/**
 * Masks a FHIR payload in place-safe fashion (returns a new object). Handles
 * single resources and searchset/collection Bundles. Non-FHIR shapes pass
 * through unchanged.
 */
export function applyMinimumNecessary(
  payload: unknown,
  grantedScopes: readonly SmartScope[],
): unknown {
  if (!isRecord(payload)) return payload;

  const resourceType = payload['resourceType'];

  if (resourceType === 'Bundle') {
    const entries = payload['entry'];
    if (!Array.isArray(entries)) return payload;
    const maskedEntries = entries.map((entry) => {
      if (!isRecord(entry)) return entry;
      const res = entry['resource'];
      if (!isRecord(res)) return entry;
      const rt = typeof res['resourceType'] === 'string' ? res['resourceType'] : '';
      if (canSeeContactFields(grantedScopes, rt)) return entry;
      return { ...entry, resource: maskResource(res) };
    });
    return { ...payload, entry: maskedEntries };
  }

  if (typeof resourceType === 'string') {
    if (canSeeContactFields(grantedScopes, resourceType)) return payload;
    return maskResource(payload);
  }

  return payload;
}
