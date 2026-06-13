import { z } from "zod";

/**
 * Audit event contract. Producers: api-gateway audit interceptor, deid-service,
 * Kafka `audit.events` topic. Consumer: audit-service, which appends each event
 * to the hash-chained `audit_log` table.
 */
export const AuditEventSchema = z.object({
  /** ISO-8601 event time; the audit-service stamps `now()` when omitted. */
  ts: z.string().datetime({ offset: true }).optional(),
  /** Subject id from the access token (user id, client id, or "anonymous"). */
  actorId: z.string().min(1),
  /** e.g. "clinician", "patient", "service", "admin". */
  actorRole: z.string().min(1),
  /** Convention: "METHOD /path", e.g. "GET /fhir/Observation". */
  action: z.string().min(1),
  /** FHIR resource type or domain entity, e.g. "Patient", "CohortQuery". */
  resourceType: z.string().min(1),
  /** Logical id of the touched resource, or "-" when not applicable. */
  resourceId: z.string().min(1),
  ip: z.string().max(64).optional(),
  userAgent: z.string().max(512).optional(),
  /** Required for break-glass access; surfaced in compliance review. */
  justification: z.string().max(2000).optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/**
 * Field names that constitute PHI in MedFlow payloads. Used to build pino
 * redaction lists so PHI can never reach logs, no matter the nesting depth.
 */
export const PHI_FIELDS = [
  "name",
  "mrn",
  "ssn",
  "dob",
  "phone",
  "email",
  "address",
  "birthDate",
  "telecom",
] as const;
export type PhiField = (typeof PHI_FIELDS)[number];

/**
 * Builds a pino `redact.paths` array covering PHI fields at the top level and
 * at common nesting depths (pino redaction does not support `**` globs).
 *
 * Example output entries: "name", "*.name", "*.*.name", "req.body.name", ...
 */
export function buildPinoRedactPaths(extraRoots: readonly string[] = []): string[] {
  const roots = ["", "*.", "*.*.", "*.*.*.", ...extraRoots.map((r) => `${r}.`)];
  const paths: string[] = [];
  for (const field of PHI_FIELDS) {
    for (const root of roots) {
      paths.push(`${root}${field}`);
    }
  }
  return paths;
}
