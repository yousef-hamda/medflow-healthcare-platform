/**
 * Attribute-Based Access Control (ABAC) primitives.
 *
 * A Policy is a small, pure predicate over subject and resource attributes.
 * The PolicyEngine evaluates the ordered policy set; an explicit Deny always
 * wins over any Allow (deny-overrides), and the default is Deny.
 */

export type PolicyEffect = 'allow' | 'deny';

/** Action verb being attempted, e.g. 'read', 'write', 'audit-read'. */
export type PolicyAction = string;

/** Subject (caller) attributes derived from the access token + user record. */
export interface SubjectAttributes {
  userId: string;
  role: string;
  /** FHIR Patient ids the subject's care teams cover (clinicians). */
  careTeamPatientIds: string[];
  /** FHIR Patient id linked to a patient-role subject, if any. */
  linkedPatientId?: string;
  /** Active break-glass patient grants for this subject. */
  breakGlassPatientIds: string[];
}

/** Resource attributes for the thing being accessed. */
export interface ResourceAttributes {
  resourceType: string;
  /** Patient the resource belongs to (FHIR Patient id), when applicable. */
  patientId?: string;
}

export interface Policy {
  name: string;
  effect: PolicyEffect;
  /** Actions this policy applies to; '*' matches any action. */
  actions: PolicyAction[];
  /** Resource type this policy applies to; '*' matches any type. */
  resourceType: string;
  /** Predicate deciding whether the policy fires for this request. */
  condition(
    subject: SubjectAttributes,
    resource: ResourceAttributes,
  ): boolean;
}

export interface PolicyDecision {
  decision: 'allow' | 'deny';
  reason: string;
}
