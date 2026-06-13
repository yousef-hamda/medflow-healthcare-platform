/** Centralized, stable TanStack Query keys. */
export const queryKeys = {
  userMe: () => ["user", "me"] as const,
  worklist: () => ["worklist"] as const,
  patient: (id: string) => ["patient", id] as const,
  observations: (patientId: string, params?: Record<string, unknown>) =>
    ["observations", patientId, params ?? {}] as const,
  conditions: (patientId: string) => ["conditions", patientId] as const,
  medications: (patientId: string) => ["medications", patientId] as const,
  imagingStudies: (patientId: string) => ["imagingStudies", patientId] as const,
  documentReferences: (patientId: string) => ["documentReferences", patientId] as const,
  cdsServices: () => ["cds", "services"] as const,
  cdsCards: (serviceId: string, patientId: string) =>
    ["cds", "cards", serviceId, patientId] as const,
  audit: (params: Record<string, unknown>) => ["audit", params] as const,
  adminModels: () => ["admin", "models"] as const,
  messages: (patientId: string) => ["messages", patientId] as const,
  appointments: (patientId: string) => ["appointments", patientId] as const,
} as const;
