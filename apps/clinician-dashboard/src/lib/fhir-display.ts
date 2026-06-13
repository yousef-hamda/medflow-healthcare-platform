import type {
  CodeableConcept,
  Condition,
  DocumentReference,
  HumanName,
  MedicationRequest,
  Observation,
  Patient,
} from "@medflow/fhir-types";

/** Best-effort display name from a FHIR HumanName list. */
export function patientName(patient: Patient | undefined): string {
  if (!patient?.name?.length) return "Unknown patient";
  return formatHumanName(patient.name[0]);
}

export function formatHumanName(name: HumanName | undefined): string {
  if (!name) return "Unknown";
  if (name.text) return name.text;
  const given = (name.given ?? []).join(" ");
  return [given, name.family].filter(Boolean).join(" ") || "Unknown";
}

/** First MRN-like identifier value, falling back to any identifier. */
export function patientMrn(patient: Patient | undefined): string {
  const identifiers = patient?.identifier ?? [];
  const mrn = identifiers.find((id) =>
    (id.type?.coding ?? []).some((c) => c.code === "MR"),
  );
  return mrn?.value ?? identifiers[0]?.value ?? "";
}

export function codeableText(concept: CodeableConcept | undefined): string {
  if (!concept) return "";
  if (concept.text) return concept.text;
  const coding = concept.coding?.[0];
  return coding?.display ?? coding?.code ?? "";
}

export function conditionLabel(condition: Condition): string {
  return codeableText(condition.code) || "Unspecified condition";
}

export function medicationLabel(med: MedicationRequest): string {
  return (
    codeableText(med.medicationCodeableConcept) ||
    med.medicationReference?.display ||
    "Unspecified medication"
  );
}

export function documentTitle(doc: DocumentReference): string {
  return codeableText(doc.type) || doc.description || "Clinical note";
}

/** Numeric value of an Observation (valueQuantity preferred). */
export function observationValue(obs: Observation): number | undefined {
  if (typeof obs.valueQuantity?.value === "number") return obs.valueQuantity.value;
  if (typeof obs.valueInteger === "number") return obs.valueInteger;
  return undefined;
}

export function observationTime(obs: Observation): number | undefined {
  const iso = obs.effectiveDateTime ?? obs.issued ?? obs.effectivePeriod?.start;
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

/** Computes age in whole years from a FHIR date (YYYY or YYYY-MM-DD). */
export function ageFromBirthDate(birthDate: string | undefined, now = new Date()): number | undefined {
  if (!birthDate) return undefined;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return undefined;
  let age = now.getFullYear() - born.getFullYear();
  const m = now.getMonth() - born.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age -= 1;
  return age;
}
