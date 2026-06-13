import { describe, expect, it } from "vitest";

import {
  criteriaToCsv,
  criteriaToRequest,
  mapCohortResponse,
  type CohortCriterion,
} from "./cohort";

describe("mapCohortResponse", () => {
  it("normalizes count and demographics", () => {
    const result = mapCohortResponse({
      count: 42,
      demographics: {
        ageBuckets: [
          { bucket: "0-17", count: 5 },
          { bucket: "18-39", count: 20 },
        ],
        gender: { male: 25, female: 17 },
      },
    });
    expect(result.count).toBe(42);
    expect(result.ageBuckets).toHaveLength(2);
    expect(result.genderBreakdown).toEqual([
      { gender: "male", count: 25 },
      { gender: "female", count: 17 },
    ]);
  });

  it("tolerates missing demographics", () => {
    const result = mapCohortResponse({ count: 3 });
    expect(result.count).toBe(3);
    expect(result.ageBuckets).toEqual([]);
    expect(result.genderBreakdown).toEqual([]);
  });
});

describe("criteriaToCsv", () => {
  const criteria: CohortCriterion[] = [
    { id: "1", type: "ageRange", minAge: 18, maxAge: 65 },
    { id: "2", type: "gender", gender: "female" },
    { id: "3", type: "condition", code: "44054006", display: "Type 2 diabetes mellitus" },
  ];

  it("emits a criteria section and a result section", () => {
    const csv = criteriaToCsv(criteria, {
      count: 10,
      ageBuckets: [{ bucket: "18-39", count: 6 }],
      genderBreakdown: [{ gender: "female", count: 10 }],
    });
    expect(csv).toContain("section,index,type,detail");
    expect(csv).toContain("Age 18–65");
    expect(csv).toContain("Gender = female");
    expect(csv).toContain("result,count,10");
    expect(csv).toContain("result,age:18-39,6");
  });

  it("escapes values containing commas", () => {
    const csv = criteriaToCsv(
      [{ id: "1", type: "medication", code: "x", display: "Drug, 5 mg" }],
      null,
    );
    expect(csv).toContain('"Medication: Drug, 5 mg (x)"');
  });
});

describe("criteriaToRequest", () => {
  it("flattens criteria into filter fields", () => {
    const req = criteriaToRequest([
      { id: "1", type: "ageRange", minAge: 30, maxAge: 50 },
      { id: "2", type: "gender", gender: "male" },
      { id: "3", type: "condition", code: "C1", display: "Cond" },
      { id: "4", type: "medication", code: "M1", display: "Med" },
    ]);
    const filters = req.filters as Record<string, unknown>;
    expect(filters.ageMin).toBe(30);
    expect(filters.ageMax).toBe(50);
    expect(filters.gender).toBe("male");
    expect(filters.conditions).toEqual(["C1"]);
    expect(filters.medications).toEqual(["M1"]);
  });
});
