/**
 * Shared Zod validation helpers for CDS Hooks request bodies.
 *
 * Pure module — no side effects, easy to unit-test.
 */

import { z } from 'zod';
import {
  CdsHooksRequestSchema,
  PatientViewContextSchema,
  EncounterDischargeContextSchema,
  CdsFeedbackRequestSchema,
} from '@medflow/shared-types';

// ── Re-export schema types ────────────────────────────────────────────────────

export type ParsedCdsHooksRequest = z.infer<typeof CdsHooksRequestSchema>;
export type ParsedPatientViewContext = z.infer<typeof PatientViewContextSchema>;
export type ParsedEncounterDischargeContext = z.infer<typeof EncounterDischargeContextSchema>;
export type ParsedCdsFeedbackRequest = z.infer<typeof CdsFeedbackRequestSchema>;

// ── Composed validators ───────────────────────────────────────────────────────

/**
 * Validates the generic CDS Hooks request envelope AND the patient-view
 * context shape.  Returns a typed result or throws a ZodError.
 */
export function parsePatientViewRequest(body: unknown): {
  request: ParsedCdsHooksRequest;
  context: ParsedPatientViewContext;
} {
  const request = CdsHooksRequestSchema.parse(body);
  const context = PatientViewContextSchema.parse(request.context);
  return { request, context };
}

/**
 * Validates the generic CDS Hooks request envelope AND the encounter-discharge
 * context shape.  Returns a typed result or throws a ZodError.
 */
export function parseEncounterDischargeRequest(body: unknown): {
  request: ParsedCdsHooksRequest;
  context: ParsedEncounterDischargeContext;
} {
  const request = CdsHooksRequestSchema.parse(body);
  const context = EncounterDischargeContextSchema.parse(request.context);
  return { request, context };
}

/**
 * Validates a CDS Hooks feedback body.  Throws ZodError on failure.
 */
export function parseFeedbackRequest(body: unknown): ParsedCdsFeedbackRequest {
  return CdsFeedbackRequestSchema.parse(body);
}

// ── Zod error formatting ──────────────────────────────────────────────────────

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Converts a ZodError into a flat list of field-level error messages suitable
 * for returning in a 400 response body.
 */
export function formatZodErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
