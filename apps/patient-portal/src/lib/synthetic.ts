import type { AllergyEntry } from "@/lib/api/hooks/useFhir";

/**
 * Bundled synthetic allergy list used as a friendly fallback when the gateway
 * does not proxy AllergyIntolerance. Clearly synthetic — for demo only.
 */
export const SYNTHETIC_ALLERGIES: readonly AllergyEntry[] = [
  { id: "syn-allergy-1", substance: "Penicillin", reaction: "Hives", severity: "high" },
  { id: "syn-allergy-2", substance: "Peanuts", reaction: "Swelling", severity: "high" },
  { id: "syn-allergy-3", substance: "Latex", reaction: "Skin irritation", severity: "low" },
];
