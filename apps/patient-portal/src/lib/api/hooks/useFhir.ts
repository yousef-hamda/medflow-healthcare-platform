import { useQuery } from "@tanstack/react-query";
import type { Condition, MedicationRequest, Observation, Patient } from "@medflow/fhir-types";
import { queryKeys } from "@/lib/api/query-keys";
import { bundleResources, fhirSearch } from "@/lib/api/fhir";

const STALE = 60 * 1000;

export function useMyConditions() {
  return useQuery({
    queryKey: queryKeys.conditions,
    queryFn: async (): Promise<Condition[]> => {
      const bundle = await fhirSearch("Condition", { _sort: "-recorded-date" });
      return bundleResources<Condition>(bundle, "Condition");
    },
    staleTime: STALE,
  });
}

export function useMyMedications() {
  return useQuery({
    queryKey: queryKeys.medications,
    queryFn: async (): Promise<MedicationRequest[]> => {
      const bundle = await fhirSearch("MedicationRequest", { status: "active" });
      return bundleResources<MedicationRequest>(bundle, "MedicationRequest");
    },
    staleTime: STALE,
  });
}

/**
 * Allergies via FHIR AllergyIntolerance. The gateway may not proxy this
 * resource; in that case the search returns an empty bundle and callers fall
 * back to a bundled synthetic list.
 */
export interface AllergyEntry {
  id: string;
  substance: string;
  reaction?: string;
  severity?: string;
}

export function useMyAllergies() {
  return useQuery({
    queryKey: queryKeys.allergies,
    queryFn: async (): Promise<AllergyEntry[]> => {
      try {
        const bundle = await fhirSearch("AllergyIntolerance");
        const entries = bundle.entry ?? [];
        const allergies: AllergyEntry[] = [];
        for (const e of entries) {
          const res = e.resource as unknown as {
            resourceType?: string;
            id?: string;
            code?: { text?: string; coding?: Array<{ display?: string }> };
            criticality?: string;
            reaction?: Array<{ manifestation?: Array<{ text?: string; coding?: Array<{ display?: string }> }> }>;
          };
          if (res?.resourceType !== "AllergyIntolerance") continue;
          allergies.push({
            id: res.id ?? crypto.randomUUID(),
            substance: res.code?.text ?? res.code?.coding?.[0]?.display ?? "Unknown",
            reaction: res.reaction?.[0]?.manifestation?.[0]?.text ?? res.reaction?.[0]?.manifestation?.[0]?.coding?.[0]?.display,
            severity: res.criticality,
          });
        }
        return allergies;
      } catch {
        return [];
      }
    },
    staleTime: STALE,
  });
}

export function useMyObservations(category: string, params?: Record<string, string>) {
  return useQuery({
    queryKey: queryKeys.observations(category, params),
    queryFn: async (): Promise<Observation[]> => {
      const bundle = await fhirSearch("Observation", { category, _sort: "-date", ...params });
      return bundleResources<Observation>(bundle, "Observation");
    },
    staleTime: STALE,
  });
}

export function useMyPatient(patientId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.patient, patientId],
    enabled: Boolean(patientId),
    queryFn: async (): Promise<Patient | undefined> => {
      const bundle = await fhirSearch("Patient", { _id: patientId });
      return bundleResources<Patient>(bundle, "Patient")[0];
    },
    staleTime: 5 * 60 * 1000,
  });
}
