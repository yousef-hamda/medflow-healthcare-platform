/** Centralised TanStack Query keys for the patient portal. */
export const queryKeys = {
  me: ["me"] as const,
  patient: ["patient"] as const,
  conditions: ["fhir", "Condition"] as const,
  medications: ["fhir", "MedicationRequest"] as const,
  allergies: ["fhir", "AllergyIntolerance"] as const,
  observations: (category: string, params?: Record<string, string>) =>
    ["fhir", "Observation", category, params ?? {}] as const,
  appointments: ["appointments"] as const,
  messages: ["messages"] as const,
};
