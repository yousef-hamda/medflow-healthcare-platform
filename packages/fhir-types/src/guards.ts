/** Runtime type guards for FHIR R4 payloads received over the wire. */

import type {
  Bundle,
  Condition,
  DiagnosticReport,
  DocumentReference,
  Encounter,
  ImagingStudy,
  MedicationRequest,
  Observation,
  OperationOutcome,
  Patient,
  Resource,
  ServiceRequest,
} from "./resources.js";

/** True when the value is shaped like *some* FHIR resource. */
export function isFhirResource(value: unknown): value is Resource {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { resourceType?: unknown }).resourceType === "string" &&
    (value as { resourceType: string }).resourceType.length > 0
  );
}

function makeGuard<T extends Resource>(resourceType: T["resourceType"]) {
  return (value: unknown): value is T =>
    isFhirResource(value) && value.resourceType === resourceType;
}

export const isPatient = makeGuard<Patient>("Patient");
export const isEncounter = makeGuard<Encounter>("Encounter");
export const isObservation = makeGuard<Observation>("Observation");
export const isCondition = makeGuard<Condition>("Condition");
export const isMedicationRequest = makeGuard<MedicationRequest>("MedicationRequest");
export const isDiagnosticReport = makeGuard<DiagnosticReport>("DiagnosticReport");
export const isImagingStudy = makeGuard<ImagingStudy>("ImagingStudy");
export const isDocumentReference = makeGuard<DocumentReference>("DocumentReference");
export const isServiceRequest = makeGuard<ServiceRequest>("ServiceRequest");
export const isOperationOutcome = makeGuard<OperationOutcome>("OperationOutcome");

export function isBundle(value: unknown): value is Bundle<Resource> {
  return isFhirResource(value) && value.resourceType === "Bundle";
}

/** Extracts typed resources of one type from a searchset/collection bundle. */
export function resourcesOfType<T extends Resource>(
  bundle: Bundle<Resource>,
  guard: (value: unknown) => value is T,
): T[] {
  return (bundle.entry ?? [])
    .map((entry) => entry.resource)
    .filter((resource): resource is T => guard(resource));
}
