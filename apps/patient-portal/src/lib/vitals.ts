import type { Observation } from "@medflow/fhir-types";

/** LOINC codes for the vital signs we chart. */
export const VITAL_LOINC = {
  heartRate: "8867-4",
  bloodPressure: "85354-9",
  systolic: "8480-6",
  diastolic: "8462-4",
  weight: "29463-7",
  spo2: "59408-5",
  spo2Alt: "2708-6",
  temperature: "8310-5",
  respRate: "9279-1",
} as const;

export type VitalMetric = "heartRate" | "bloodPressure" | "weight" | "spo2" | "temperature" | "respRate";

export interface VitalSample {
  ts: number;
  /** Primary numeric value (for BP this is systolic). */
  value?: number;
  /** Secondary value (BP diastolic). */
  value2?: number;
  unit?: string;
}

function loincOf(obs: Observation): string | undefined {
  return obs.code.coding?.find((c) => c.system?.includes("loinc"))?.code ?? obs.code.coding?.[0]?.code;
}

function effectiveTs(obs: Observation): number | undefined {
  const iso = obs.effectiveDateTime ?? obs.effectivePeriod?.start ?? obs.issued;
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? undefined : t;
}

function componentValue(obs: Observation, code: string): number | undefined {
  const comp = obs.component?.find((c) => c.code.coding?.some((cd) => cd.code === code));
  return typeof comp?.valueQuantity?.value === "number" ? comp.valueQuantity.value : undefined;
}

/**
 * Extracts a per-metric list of samples from a flat list of vital sign
 * Observations, sorted oldest-first. Handles blood pressure components.
 */
export function extractVitalSamples(observations: readonly Observation[], metric: VitalMetric): VitalSample[] {
  const samples: VitalSample[] = [];
  for (const obs of observations) {
    const code = loincOf(obs);
    const ts = effectiveTs(obs);
    if (ts === undefined) continue;

    if (metric === "bloodPressure") {
      if (code !== VITAL_LOINC.bloodPressure) continue;
      const systolic = componentValue(obs, VITAL_LOINC.systolic);
      const diastolic = componentValue(obs, VITAL_LOINC.diastolic);
      if (systolic === undefined && diastolic === undefined) continue;
      samples.push({ ts, value: systolic, value2: diastolic, unit: "mmHg" });
      continue;
    }

    const matchCodes: Record<Exclude<VitalMetric, "bloodPressure">, string[]> = {
      heartRate: [VITAL_LOINC.heartRate],
      weight: [VITAL_LOINC.weight],
      spo2: [VITAL_LOINC.spo2, VITAL_LOINC.spo2Alt],
      temperature: [VITAL_LOINC.temperature],
      respRate: [VITAL_LOINC.respRate],
    };
    if (!code || !matchCodes[metric].includes(code)) continue;
    const value = obs.valueQuantity?.value;
    if (typeof value !== "number") continue;
    samples.push({ ts, value, unit: obs.valueQuantity?.unit });
  }
  return samples.sort((a, b) => a.ts - b.ts);
}

/** Filters samples to those within the last `days` days (or all if undefined). */
export function withinWindow(samples: readonly VitalSample[], days: number | undefined, now = Date.now()): VitalSample[] {
  if (!days) return [...samples];
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  return samples.filter((s) => s.ts >= cutoff);
}
