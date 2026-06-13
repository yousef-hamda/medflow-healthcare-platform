import { z } from "zod";

/**
 * CDS Hooks 1.1 (https://cds-hooks.org) request/response contracts.
 * Pragmatic subset covering discovery, service invocation, cards and feedback.
 */

export const CdsIndicatorSchema = z.enum(["info", "warning", "critical"]);
export type CdsIndicator = z.infer<typeof CdsIndicatorSchema>;

export const CdsHooksFhirAuthorizationSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  subject: z.string(),
  patient: z.string().optional(),
});
export type CdsHooksFhirAuthorization = z.infer<typeof CdsHooksFhirAuthorizationSchema>;

/** Generic CDS Hooks request; `context` is hook-specific. */
export const CdsHooksRequestSchema = z.object({
  hook: z.string().min(1),
  hookInstance: z.string().min(1),
  fhirServer: z.string().url().optional(),
  fhirAuthorization: CdsHooksFhirAuthorizationSchema.optional(),
  context: z.record(z.unknown()),
  prefetch: z.record(z.unknown()).optional(),
});
export type CdsHooksRequest = z.infer<typeof CdsHooksRequestSchema>;

/** Context for the `patient-view` hook. */
export const PatientViewContextSchema = z.object({
  userId: z.string().min(1),
  patientId: z.string().min(1),
  encounterId: z.string().optional(),
});
export type PatientViewContext = z.infer<typeof PatientViewContextSchema>;

/** Context for the `encounter-discharge` hook. */
export const EncounterDischargeContextSchema = z.object({
  userId: z.string().min(1),
  patientId: z.string().min(1),
  encounterId: z.string().min(1),
});
export type EncounterDischargeContext = z.infer<typeof EncounterDischargeContextSchema>;

export interface CdsCardSource {
  label: string;
  url?: string;
  icon?: string;
  topic?: { system?: string; code?: string; display?: string };
}

export interface CdsAction {
  type: "create" | "update" | "delete";
  description: string;
  /** A FHIR resource for create/update actions. */
  resource?: Record<string, unknown>;
  resourceId?: string;
}

export interface CdsSuggestion {
  label: string;
  uuid?: string;
  isRecommended?: boolean;
  actions?: CdsAction[];
}

export interface CdsLink {
  label: string;
  url: string;
  type: "absolute" | "smart";
  appContext?: string;
}

export interface CdsCard {
  uuid?: string;
  /** Max 140 chars per spec. */
  summary: string;
  detail?: string;
  indicator: CdsIndicator;
  source: CdsCardSource;
  suggestions?: CdsSuggestion[];
  selectionBehavior?: "at-most-one" | "any";
  overrideReasons?: Array<{ code: string; system?: string; display?: string }>;
  links?: CdsLink[];
}

export interface CdsHooksResponse {
  cards: CdsCard[];
  systemActions?: CdsAction[];
}

export interface CdsServiceDefinition {
  hook: string;
  id: string;
  title?: string;
  description: string;
  prefetch?: Record<string, string>;
  usageRequirements?: string;
}

export interface CdsServicesDiscoveryResponse {
  services: CdsServiceDefinition[];
}

export const CdsFeedbackSchema = z.object({
  card: z.string().min(1),
  outcome: z.enum(["accepted", "overridden"]),
  outcomeTimestamp: z.string().datetime({ offset: true }),
  acceptedSuggestions: z.array(z.object({ id: z.string() })).optional(),
  overrideReason: z
    .object({
      reason: z.object({ code: z.string(), system: z.string().optional() }).optional(),
      userComment: z.string().optional(),
    })
    .optional(),
});
export type CdsFeedback = z.infer<typeof CdsFeedbackSchema>;

export const CdsFeedbackRequestSchema = z.object({
  feedback: z.array(CdsFeedbackSchema).min(1),
});
export type CdsFeedbackRequest = z.infer<typeof CdsFeedbackRequestSchema>;
