/**
 * Maps a FHIR R4 Observation Bundle (vital-signs category) into the
 * flat vitals_window array expected by the ML serving /predict/* endpoints.
 *
 * Pure module — no I/O, no side effects, fully unit-testable.
 */

import type { Bundle, Observation } from '@medflow/fhir-types';
import { isObservation, resourcesOfType } from '@medflow/fhir-types';

// LOINC codes we recognise and their field mappings
const LOINC_FIELD_MAP: Record<string, keyof VitalsWindow> = {
  '8867-4': 'heartRate',       // Heart rate
  '9279-1': 'respiratoryRate', // Respiratory rate
  '59408-5': 'spo2',           // Oxygen saturation (pulse ox)
  '2708-6': 'spo2',            // Oxygen saturation (arterial) — fallback
  '8480-6': 'systolicBp',      // Systolic blood pressure
  '8462-4': 'diastolicBp',     // Diastolic blood pressure
  '8310-5': 'temperatureC',    // Body temperature
  '8331-1': 'temperatureC',    // Oral temperature
};

export interface VitalsWindow {
  ts: string;
  heartRate?: number;
  respiratoryRate?: number;
  spo2?: number;
  systolicBp?: number;
  diastolicBp?: number;
  temperatureC?: number;
}

/**
 * Extracts the effective timestamp from an Observation, preferring
 * effectiveDateTime over effectivePeriod.start.
 */
function effectiveTs(obs: Observation): string | undefined {
  return obs.effectiveDateTime ?? obs.effectivePeriod?.start;
}

/**
 * Returns the numeric value from an Observation, checking valueQuantity first,
 * then the first component's valueQuantity (blood-pressure panel).
 */
function numericValue(obs: Observation, field: keyof VitalsWindow): number | undefined {
  // Direct value
  if (obs.valueQuantity?.value !== undefined) {
    return obs.valueQuantity.value;
  }

  // Blood-pressure is a panel with two components; pick the right one
  if (obs.component) {
    for (const comp of obs.component) {
      const loincCode = comp.code.coding?.find((c) => c.system === 'http://loinc.org')?.code;
      if (loincCode && LOINC_FIELD_MAP[loincCode] === field) {
        return comp.valueQuantity?.value;
      }
    }
  }

  return undefined;
}

/**
 * Maps an Observation to (ts, field, value) triples.
 * One Observation may contribute multiple fields (e.g. BP panel).
 */
function observationToEntries(obs: Observation): Array<{ ts: string; field: keyof VitalsWindow; value: number }> {
  const ts = effectiveTs(obs);
  if (!ts) return [];

  const results: Array<{ ts: string; field: keyof VitalsWindow; value: number }> = [];

  // Direct LOINC code on the root observation
  const rootLoinc = obs.code.coding?.find((c) => c.system === 'http://loinc.org')?.code;
  if (rootLoinc) {
    const field = LOINC_FIELD_MAP[rootLoinc];
    if (field) {
      const value = numericValue(obs, field);
      if (value !== undefined) {
        results.push({ ts, field, value });
      }
    }
  }

  // Component-level codes (blood-pressure panel, multi-vital panels)
  if (obs.component) {
    for (const comp of obs.component) {
      const compLoinc = comp.code.coding?.find((c) => c.system === 'http://loinc.org')?.code;
      if (!compLoinc) continue;
      const field = LOINC_FIELD_MAP[compLoinc];
      if (!field) continue;
      const value = comp.valueQuantity?.value;
      if (value !== undefined) {
        results.push({ ts, field, value });
      }
    }
  }

  return results;
}

/**
 * Converts a FHIR searchset Bundle of Observations into a time-ordered array
 * of VitalsWindow snapshots (one entry per unique timestamp).
 *
 * - Only Observations with a recognised LOINC vital-signs code are included.
 * - Observations sharing the same effectiveDateTime are merged into one window.
 * - Returned array is sorted ascending by timestamp (oldest first) because the
 *   ML model expects a time-series ordered window.
 */
export function bundleToVitalsWindow(bundle: Bundle<Observation>): VitalsWindow[] {
  const observations = resourcesOfType(bundle, isObservation);

  // Group by timestamp
  const byTs = new Map<string, VitalsWindow>();

  for (const obs of observations) {
    const entries = observationToEntries(obs);
    for (const { ts, field, value } of entries) {
      const existing = byTs.get(ts) ?? { ts };
      // Last-write-wins when multiple observations share the same ts and field
      (existing as Record<string, unknown>)[field] = value;
      byTs.set(ts, existing);
    }
  }

  // Sort ascending by ISO timestamp string (lexicographic ≡ chronological for ISO-8601)
  return Array.from(byTs.values()).sort((a, b) => a.ts.localeCompare(b.ts));
}
