/** Central query key factory — first segment doubles as the persistence scope. */

export const queryKeys = {
  me: () => ["me"] as const,
  appointments: () => ["appointments"] as const,
  results: () => ["results"] as const,
  resultDetail: (id: string) => ["results", id] as const,
  conditions: (patientId: string) => ["records", "conditions", patientId] as const,
  medications: (patientId: string) => ["records", "medications", patientId] as const,
  allergies: (patientId: string) => ["records", "allergies", patientId] as const,
  vitals: (patientId: string, days: number) => ["vitals", patientId, days] as const,
  threads: () => ["messages"] as const,
  thread: (threadId: string) => ["messages", threadId] as const,
};
