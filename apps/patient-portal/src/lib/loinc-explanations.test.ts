import { describe, expect, it } from "vitest";
import { explainLoinc, LOINC_EXPLANATIONS } from "./loinc-explanations";

describe("explainLoinc", () => {
  it("returns a known entry for a mapped LOINC code", () => {
    const creatinine = explainLoinc("2160-0");
    expect(creatinine).toBeDefined();
    expect(creatinine?.short).toBe("Creatinine");
    expect(creatinine?.plain.length).toBeGreaterThan(10);
  });

  it("returns hemoglobin A1c for 4548-4", () => {
    expect(explainLoinc("4548-4")?.short).toBe("Hemoglobin A1c");
  });

  it("trims whitespace before lookup", () => {
    expect(explainLoinc("  718-7 ")?.short).toBe("Hemoglobin");
  });

  it("returns undefined for an unknown code", () => {
    expect(explainLoinc("00000-0")).toBeUndefined();
  });

  it("returns undefined for null/empty input", () => {
    expect(explainLoinc(undefined)).toBeUndefined();
    expect(explainLoinc(null)).toBeUndefined();
    expect(explainLoinc("")).toBeUndefined();
  });

  it("has at least 20 explanations", () => {
    expect(Object.keys(LOINC_EXPLANATIONS).length).toBeGreaterThanOrEqual(20);
  });

  it("each explanation has matching code, short and plain", () => {
    for (const [key, entry] of Object.entries(LOINC_EXPLANATIONS)) {
      expect(entry.code).toBe(key);
      expect(entry.short.length).toBeGreaterThan(0);
      expect(entry.plain.length).toBeGreaterThan(0);
    }
  });
});
