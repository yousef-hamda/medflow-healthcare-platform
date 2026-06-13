/**
 * Thin FHIR R4 fetch client used when prefetch is absent.
 * Attaches a Bearer token when fhirAuthorization is provided.
 */

import type { Bundle, Observation } from '@medflow/fhir-types';
import { isBundle } from '@medflow/fhir-types';
import type { CdsHooksFhirAuthorization } from '@medflow/shared-types';
import { logger } from '../logger.js';

export interface FhirClientOptions {
  baseUrl: string;
  auth?: CdsHooksFhirAuthorization;
  timeoutMs?: number;
}

/**
 * Executes a FHIR search and returns the parsed Bundle.
 * Throws on HTTP errors or when the response is not a Bundle.
 */
async function fhirSearch(
  path: string,
  options: FhirClientOptions,
): Promise<Bundle<Observation>> {
  const url = `${options.baseUrl}/${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

  const headers: Record<string, string> = {
    Accept: 'application/fhir+json',
    'Content-Type': 'application/fhir+json',
  };

  if (options.auth) {
    headers['Authorization'] = `Bearer ${options.auth.access_token}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `FHIR fetch failed: ${response.status} ${response.statusText} for ${url}`,
      );
    }

    const data: unknown = await response.json();

    if (!isBundle(data)) {
      throw new Error(`FHIR response is not a Bundle for ${url}`);
    }

    return data as Bundle<Observation>;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches the 50 most-recent vital-signs Observations for a patient.
 */
export async function fetchRecentVitals(
  patientId: string,
  options: FhirClientOptions,
): Promise<Bundle<Observation>> {
  logger.debug({ patientId }, 'Fetching recent vitals from FHIR server');
  return fhirSearch(
    `Observation?patient=${encodeURIComponent(patientId)}&category=vital-signs&_sort=-date&_count=50`,
    options,
  );
}

/**
 * Fetches an Encounter by id, returning the raw JSON.
 */
export async function fetchEncounter(
  encounterId: string,
  options: FhirClientOptions,
): Promise<unknown> {
  const url = `${options.baseUrl}/Encounter/${encodeURIComponent(encounterId)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);

  const headers: Record<string, string> = {
    Accept: 'application/fhir+json',
  };
  if (options.auth) {
    headers['Authorization'] = `Bearer ${options.auth.access_token}`;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `FHIR fetch failed: ${response.status} ${response.statusText} for ${url}`,
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches active Conditions for a patient.
 */
export async function fetchActiveConditions(
  patientId: string,
  options: FhirClientOptions,
): Promise<Bundle<Observation>> {
  logger.debug({ patientId }, 'Fetching active conditions from FHIR server');
  return fhirSearch(
    `Condition?patient=${encodeURIComponent(patientId)}&clinical-status=active&_count=50`,
    options,
  );
}
