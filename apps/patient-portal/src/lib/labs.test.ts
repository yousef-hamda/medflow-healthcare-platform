import { describe, expect, it } from "vitest";
import type { Observation } from "@medflow/fhir-types";
import { flagForValue, groupResultsByPanel, formatRange } from "./labs";

describe("flagForValue", () => {
  const range = { low: 70, high: 99 };
  it("flags below-range values as low", () => {
    expect(flagForValue(60, range)).toBe("low");
  });
  it("flags above-range values as high", () => {
    expect(flagForValue(120, range)).toBe("high");
  });
  it("flags in-range values as normal", () => {
    expect(flagForValue(85, range)).toBe("normal");
  });
  it("treats boundary values as normal", () => {
    expect(flagForValue(70, range)).toBe("normal");
    expect(flagForValue(99, range)).toBe("normal");
  });
  it("returns normal when there is no value or range", () => {
    expect(flagForValue(undefined, range)).toBe("normal");
    expect(flagForValue(85, undefined)).toBe("normal");
  });
});

describe("formatRange", () => {
  it("formats a two-sided range", () => {
    expect(formatRange({ low: 70, high: 99, unit: "mg/dL" })).toBe("70 – 99 mg/dL");
  });
  it("formats an upper-bound only range", () => {
    expect(formatRange({ high: 200 })).toBe("< 200");
  });
  it("prefers explicit text", () => {
    expect(formatRange({ text: "Negative" })).toBe("Negative");
  });
});

function obs(partial: Partial<Observation> & { id: string }): Observation {
  return {
    resourceType: "Observation",
    status: "final",
    code: { text: partial.id },
    ...partial,
  } as Observation;
}

describe("groupResultsByPanel", () => {
  const observations: Observation[] = [
    obs({
      id: "glucose",
      category: [{ text: "Chemistry" }],
      code: { text: "Glucose", coding: [{ system: "http://loinc.org", code: "2345-7" }] },
      valueQuantity: { value: 90, unit: "mg/dL" },
      effectiveDateTime: "2026-03-04T09:00:00Z",
    }),
    obs({
      id: "hgb",
      category: [{ text: "Hematology" }],
      code: { text: "Hemoglobin" },
      valueQuantity: { value: 14, unit: "g/dL" },
      effectiveDateTime: "2026-03-01T09:00:00Z",
    }),
    obs({
      id: "uncategorized",
      code: { text: "Mystery" },
      valueQuantity: { value: 1 },
    }),
  ];

  it("groups observations by panel/category", () => {
    const panels = groupResultsByPanel(observations);
    const names = panels.map((p) => p.panel);
    expect(names).toContain("Chemistry");
    expect(names).toContain("Hematology");
  });

  it("places uncategorized results in the 'Other' panel, sorted last", () => {
    const panels = groupResultsByPanel(observations);
    expect(panels[panels.length - 1].panel).toBe("Other");
  });

  it("extracts loinc, value and unit onto results", () => {
    const panels = groupResultsByPanel(observations);
    const chem = panels.find((p) => p.panel === "Chemistry");
    expect(chem?.results[0].loinc).toBe("2345-7");
    expect(chem?.results[0].value).toBe(90);
    expect(chem?.results[0].unit).toBe("mg/dL");
  });
});
