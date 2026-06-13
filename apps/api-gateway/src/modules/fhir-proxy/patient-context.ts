/**
 * Patient-context narrowing for SMART `launch/patient` tokens.
 *
 * When a token carries a `patient` claim, every FHIR request is constrained to
 * that compartment:
 *   - Search (collection) requests get `?patient=<id>` injected (overwriting any
 *     attacker-supplied value).
 *   - Instance reads of patient-scoped types must reference the same patient;
 *     a cross-patient instance read is rejected (caller maps to 403).
 *
 * The Patient resource itself is special-cased: `GET /Patient/<id>` is allowed
 * only when `<id>` equals the context patient.
 */

/** Resource types that live in a patient compartment and accept `?patient=`. */
const PATIENT_COMPARTMENT_TYPES = new Set([
  'Observation',
  'Condition',
  'MedicationRequest',
  'DiagnosticReport',
  'Encounter',
  'Procedure',
  'AllergyIntolerance',
  'Immunization',
  'CarePlan',
  'DocumentReference',
  'ImagingStudy',
  'ServiceRequest',
]);

export interface NarrowResult {
  /** Path + query to forward upstream (relative to FHIR base). */
  targetPath: string;
  /** When true the request crosses patient context and must be rejected (403). */
  forbidden: boolean;
  reason?: string;
}

interface ParsedFhirPath {
  resourceType: string | undefined;
  id: string | undefined;
}

function parseFhirPath(path: string): ParsedFhirPath {
  const clean = path.replace(/^\/+/, '').split('?')[0];
  const segments = clean.split('/').filter(Boolean);
  return { resourceType: segments[0], id: segments[1] };
}

/**
 * Computes the narrowed upstream path for a patient-context request.
 *
 * @param path           incoming path after `/fhir/` (e.g. "Observation" or "Patient/123")
 * @param search         URLSearchParams of the incoming query
 * @param contextPatient the `patient` claim on the access token
 */
export function narrowForPatientContext(
  path: string,
  search: URLSearchParams,
  contextPatient: string,
): NarrowResult {
  const { resourceType, id } = parseFhirPath(path);
  const params = new URLSearchParams(search);

  if (!resourceType) {
    return { targetPath: path, forbidden: false };
  }

  // Patient resource: only the context patient is visible.
  if (resourceType === 'Patient') {
    if (id) {
      if (id !== contextPatient) {
        return {
          targetPath: path,
          forbidden: true,
          reason: 'Cross-patient read denied by launch/patient context',
        };
      }
      return { targetPath: `Patient/${id}`, forbidden: false };
    }
    // Patient search → pin to _id of the context patient.
    params.set('_id', contextPatient);
    return {
      targetPath: `Patient?${params.toString()}`,
      forbidden: false,
    };
  }

  // Compartment instance read: cannot verify ownership cheaply → forbid direct
  // cross-compartment instance reads, require search with the patient filter.
  if (id && PATIENT_COMPARTMENT_TYPES.has(resourceType)) {
    return {
      targetPath: path,
      forbidden: true,
      reason:
        'Instance read not permitted under launch/patient context; use a patient-scoped search',
    };
  }

  // Compartment search: force the patient filter (overwrite any spoofed value).
  if (PATIENT_COMPARTMENT_TYPES.has(resourceType)) {
    const existing = params.get('patient');
    if (existing && existing !== contextPatient) {
      return {
        targetPath: path,
        forbidden: true,
        reason: 'Cross-patient search denied by launch/patient context',
      };
    }
    params.set('patient', contextPatient);
    return {
      targetPath: `${resourceType}?${params.toString()}`,
      forbidden: false,
    };
  }

  // Non-patient-compartment resource: forward unchanged.
  const qs = params.toString();
  return { targetPath: qs ? `${resourceType}?${qs}` : resourceType, forbidden: false };
}
