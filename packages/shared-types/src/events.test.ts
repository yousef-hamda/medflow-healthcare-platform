import { describe, expect, it } from "vitest";

import { buildPinoRedactPaths, PHI_FIELDS } from "./audit.js";
import {
  KafkaAlertEventSchema,
  PredictionEventSchema,
  riskBandFromScore,
  VitalsReadingSchema,
} from "./events.js";

describe("riskBandFromScore", () => {
  it.each([
    [0, "low"],
    [0.39, "low"],
    [0.4, "medium"],
    [0.69, "medium"],
    [0.7, "high"],
    [1, "high"],
  ] as const)("maps %d to %s", (score, band) => {
    expect(riskBandFromScore(score)).toBe(band);
  });

  it("rejects out-of-range scores", () => {
    expect(() => riskBandFromScore(-0.01)).toThrow(RangeError);
    expect(() => riskBandFromScore(1.01)).toThrow(RangeError);
    expect(() => riskBandFromScore(Number.NaN)).toThrow(RangeError);
  });

  it("honors custom thresholds", () => {
    expect(riskBandFromScore(0.5, { medium: 0.2, high: 0.9 })).toBe("medium");
  });
});

describe("schemas", () => {
  it("accepts a valid vitals reading", () => {
    const result = VitalsReadingSchema.safeParse({
      patientId: "pat-1",
      ts: "2026-06-11T10:00:00Z",
      heartRate: 92,
      spo2: 97,
      source: "wearable:fitband-04",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a vitals reading with an invalid timestamp", () => {
    const result = VitalsReadingSchema.safeParse({
      patientId: "pat-1",
      ts: "yesterday",
      source: "x",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid alert event", () => {
    const result = KafkaAlertEventSchema.safeParse({
      id: "a1",
      type: "sepsis",
      severity: "critical",
      patientId: "pat-1",
      ts: "2026-06-11T10:00:00+00:00",
      message: "Sepsis risk HIGH (0.82)",
      score: 0.82,
      band: "high",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a prediction with an unknown model", () => {
    const result = PredictionEventSchema.safeParse({
      id: "p1",
      model: "weather",
      modelVersion: "1",
      patientId: "pat-1",
      ts: "2026-06-11T10:00:00Z",
      score: 0.5,
      band: "medium",
    });
    expect(result.success).toBe(false);
  });
});

describe("buildPinoRedactPaths", () => {
  it("covers every PHI field at multiple depths", () => {
    const paths = buildPinoRedactPaths(["req.body"]);
    for (const field of PHI_FIELDS) {
      expect(paths).toContain(field);
      expect(paths).toContain(`*.${field}`);
      expect(paths).toContain(`*.*.${field}`);
      expect(paths).toContain(`req.body.${field}`);
    }
  });
});
