import type { Policy } from '../policy.types';

/**
 * Built-in MedFlow ABAC policies, evaluated in order. Deny-overrides: any
 * matching deny wins; otherwise a matching allow grants access; default deny.
 */

/** Clinicians may read a resource when they share a care team with its patient. */
export const clinicianCareTeamOverlap: Policy = {
  name: 'clinician-care-team-overlap',
  effect: 'allow',
  actions: ['read'],
  resourceType: '*',
  condition: (subject, resource) =>
    subject.role === 'clinician' &&
    resource.patientId !== undefined &&
    subject.careTeamPatientIds.includes(resource.patientId),
};

/** Patients may read their own resources (linked patient id matches). */
export const patientSelfAccess: Policy = {
  name: 'patient-self-access',
  effect: 'allow',
  actions: ['read'],
  resourceType: '*',
  condition: (subject, resource) =>
    subject.role === 'patient' &&
    subject.linkedPatientId !== undefined &&
    resource.patientId !== undefined &&
    subject.linkedPatientId === resource.patientId,
};

/** Admins may read audit records (and only audit). */
export const adminAuditRead: Policy = {
  name: 'admin-audit-read',
  effect: 'allow',
  actions: ['read', 'audit-read'],
  resourceType: 'AuditEvent',
  condition: (subject) => subject.role === 'admin',
};

/**
 * Break-glass override: an active emergency grant for a patient allows reads
 * regardless of care-team membership. Always paired with a CRITICAL audit
 * event recorded when the grant was created.
 */
export const breakGlassOverride: Policy = {
  name: 'break-glass-override',
  effect: 'allow',
  actions: ['read'],
  resourceType: '*',
  condition: (subject, resource) =>
    resource.patientId !== undefined &&
    subject.breakGlassPatientIds.includes(resource.patientId),
};

export const BUILT_IN_POLICIES: Policy[] = [
  clinicianCareTeamOverlap,
  patientSelfAccess,
  adminAuditRead,
  breakGlassOverride,
];
