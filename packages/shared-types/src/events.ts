import { z } from "zod";

/**
 * Kafka event contracts shared by producers (wearables-ingester, ml-serving,
 * Flink jobs) and consumers (realtime-gateway, audit-service, api-gateway).
 *
 * Topics: `alerts`, `vitals.aggregates`, `predictions`, `audit.events`, `fhir.changes`.
 */

export const RiskBandSchema = z.enum(["low", "medium", "high"]);
export type RiskBand = z.infer<typeof RiskBandSchema>;

export const AlertSeveritySchema = z.enum(["info", "warning", "critical"]);
export type AlertSeverity = z.infer<typeof AlertSeveritySchema>;

/** A single (possibly aggregated) vitals observation for one patient. */
export const VitalsReadingSchema = z.object({
  /** FHIR Patient logical id. */
  patientId: z.string().min(1),
  /** ISO-8601 timestamp of the reading (or window end for aggregates). */
  ts: z.string().datetime({ offset: true }),
  /** Beats per minute. */
  heartRate: z.number().min(0).max(400).optional(),
  /** Breaths per minute. */
  respiratoryRate: z.number().min(0).max(120).optional(),
  /** Peripheral oxygen saturation, percent. */
  spo2: z.number().min(0).max(100).optional(),
  systolicBp: z.number().min(0).max(400).optional(),
  diastolicBp: z.number().min(0).max(300).optional(),
  /** Body temperature, degrees Celsius. */
  temperatureC: z.number().min(20).max(45).optional(),
  /** Producing device / pipeline, e.g. "wearable:fitband-04" or "flink:1m-window". */
  source: z.string().min(1),
  /** Window length in seconds when this is an aggregate (topic vitals.aggregates). */
  windowSeconds: z.number().int().positive().optional(),
});
export type VitalsReading = z.infer<typeof VitalsReadingSchema>;

/** A SHAP-style feature attribution attached to model outputs. */
export const FeatureContributionSchema = z.object({
  feature: z.string().min(1),
  /** Signed contribution toward the positive class. */
  shapValue: z.number(),
  /** Raw feature value at prediction time (numeric features only). */
  value: z.number().optional(),
});
export type FeatureContribution = z.infer<typeof FeatureContributionSchema>;

/** Event on the `alerts` topic — clinically actionable, routed to realtime rooms. */
export const KafkaAlertEventSchema = z.object({
  /** Unique alert id (uuid). */
  id: z.string().min(1),
  type: z.enum(["sepsis", "deterioration", "readmission", "device"]),
  severity: AlertSeveritySchema,
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  ts: z.string().datetime({ offset: true }),
  /** Human-readable, PHI-free summary, e.g. "Sepsis risk HIGH (0.82)". */
  message: z.string().min(1),
  /** Model score in [0, 1] when the alert is model-driven. */
  score: z.number().min(0).max(1).optional(),
  band: RiskBandSchema.optional(),
  model: z.string().optional(),
  modelVersion: z.string().optional(),
  topContributors: z.array(FeatureContributionSchema).optional(),
});
export type KafkaAlertEvent = z.infer<typeof KafkaAlertEventSchema>;

/** Event on the `predictions` topic — every model inference is logged here. */
export const PredictionEventSchema = z.object({
  id: z.string().min(1),
  model: z.enum(["sepsis", "readmission", "chest-xray"]),
  modelVersion: z.string().min(1),
  patientId: z.string().min(1),
  encounterId: z.string().min(1).optional(),
  ts: z.string().datetime({ offset: true }),
  score: z.number().min(0).max(1),
  band: RiskBandSchema,
  topContributors: z.array(FeatureContributionSchema).optional(),
  /** Serving metadata (canary flag, latency, feature freshness), never PHI. */
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type PredictionEvent = z.infer<typeof PredictionEventSchema>;

/** Default thresholds: score < 0.4 → low, < 0.7 → medium, else high. */
export interface RiskBandThresholds {
  medium: number;
  high: number;
}

export const DEFAULT_RISK_THRESHOLDS: RiskBandThresholds = { medium: 0.4, high: 0.7 };

/** Maps a [0, 1] model score into a discrete risk band. */
export function riskBandFromScore(
  score: number,
  thresholds: RiskBandThresholds = DEFAULT_RISK_THRESHOLDS,
): RiskBand {
  if (Number.isNaN(score)) {
    throw new RangeError("score must be a number in [0, 1]");
  }
  if (score < 0 || score > 1) {
    throw new RangeError(`score must be in [0, 1], got ${score}`);
  }
  if (score >= thresholds.high) return "high";
  if (score >= thresholds.medium) return "medium";
  return "low";
}
