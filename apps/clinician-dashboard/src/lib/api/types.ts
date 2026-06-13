import type { RiskBand } from "@medflow/shared-types";

/**
 * Application-facing API response shapes for the MedFlow gateway.
 * These mirror the gateway contract; FHIR resources use @medflow/fhir-types.
 */

export interface WorklistItem {
  patientId: string;
  /** Display name (synthetic). */
  name: string;
  /** Full or masked MRN as returned by the gateway. */
  mrn: string;
  /** Primary, blended risk score in [0, 1]. */
  primaryScore: number;
  primaryBand?: RiskBand;
  sepsisScore?: number;
  readmissionScore?: number;
  /** ISO-8601 timestamp of the latest score update. */
  updatedAt: string;
  encounterId?: string;
}

export interface CurrentUser {
  id: string;
  name: string;
  role: string;
  email?: string;
  /** SMART scopes granted to this session. */
  scopes?: string[];
}

export interface FeatureContribution {
  feature: string;
  shapValue: number;
  value?: number;
}

export interface PredictionResult {
  model: "sepsis" | "readmission" | "chest-xray";
  modelVersion: string;
  patientId: string;
  score: number;
  band: RiskBand;
  topContributors?: FeatureContribution[];
}

export interface ChestXrayResult extends PredictionResult {
  /** Base64-encoded PNG saliency map (Grad-CAM), if produced. */
  gradcamPng?: string;
  /** Top label, e.g. "Pneumonia". */
  finding?: string;
}

export interface CohortDemographics {
  ageBuckets?: Array<{ bucket: string; count: number }>;
  gender?: Record<string, number>;
}

export interface CohortResponseRaw {
  count: number;
  demographics?: CohortDemographics;
}

export interface AuditEventRecord {
  id?: string;
  ts: string;
  actorId: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  ip?: string;
  userAgent?: string;
  justification?: string;
  /** Hash-chain link, surfaced for forensic detail. */
  hash?: string;
  prevHash?: string;
}

export interface AuditPage {
  events: AuditEventRecord[];
  page: number;
  pageSize: number;
  total: number;
  /** Hash-chain integrity verdict for the returned range. */
  chainValid?: boolean;
}

export interface ModelFairnessRow {
  subgroup: string;
  metric: string;
  value: number;
}

export interface ModelVersionInfo {
  version: string;
  auroc?: number;
  aurocHistory?: number[];
  trainedAt?: string;
}

export interface ModelInfo {
  id: "sepsis" | "readmission" | "chest-xray";
  name: string;
  production: ModelVersionInfo;
  canary?: ModelVersionInfo;
  driftReportUrl?: string;
  fairness?: ModelFairnessRow[];
  /** Markdown model card. */
  modelCard?: string;
}

export interface MessageRecord {
  id: string;
  patientId: string;
  authorId: string;
  authorName: string;
  body: string;
  ts: string;
  fromMe?: boolean;
}

export interface AppointmentRecord {
  id: string;
  patientId: string;
  start: string;
  end?: string;
  status: string;
  reason?: string;
}

export interface BreakGlassResponse {
  granted: boolean;
  /** Full MRN revealed under break-glass, when granted. */
  mrn?: string;
  /** Audit record id created for this access. */
  auditId?: string;
}

export interface ShareTokenResponse {
  token: string;
  url?: string;
  expiresAt?: string;
}
