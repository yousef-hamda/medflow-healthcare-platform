import { describe, expect, it } from "vitest";

import type { WorklistItem } from "@/lib/api/types";
import { primaryRisk, sortWorklist, sortWorklistByRisk } from "./risk";

function item(partial: Partial<WorklistItem> & { patientId: string }): WorklistItem {
  return {
    name: partial.name ?? partial.patientId,
    mrn: partial.mrn ?? "MRN-0000",
    primaryScore: partial.primaryScore ?? 0,
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("primaryRisk", () => {
  it("prefers the provided primaryScore", () => {
    expect(primaryRisk(item({ patientId: "a", primaryScore: 0.5, sepsisScore: 0.9 }))).toBe(0.5);
  });

  it("falls back to the max component score", () => {
    const got = primaryRisk(
      item({ patientId: "a", primaryScore: Number.NaN, sepsisScore: 0.3, readmissionScore: 0.8 }),
    );
    expect(got).toBe(0.8);
  });

  it("returns 0 when nothing is available", () => {
    expect(primaryRisk(item({ patientId: "a", primaryScore: Number.NaN }))).toBe(0);
  });
});

describe("sortWorklistByRisk", () => {
  it("orders descending by primary risk", () => {
    const items = [
      item({ patientId: "low", primaryScore: 0.1 }),
      item({ patientId: "high", primaryScore: 0.9 }),
      item({ patientId: "mid", primaryScore: 0.5 }),
    ];
    expect(sortWorklistByRisk(items).map((i) => i.patientId)).toEqual(["high", "mid", "low"]);
  });

  it("is stable for ties (preserves input order)", () => {
    const items = [
      item({ patientId: "a", primaryScore: 0.5 }),
      item({ patientId: "b", primaryScore: 0.5 }),
      item({ patientId: "c", primaryScore: 0.5 }),
    ];
    expect(sortWorklistByRisk(items).map((i) => i.patientId)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input array", () => {
    const items = [item({ patientId: "a", primaryScore: 0.1 }), item({ patientId: "b", primaryScore: 0.9 })];
    const copy = [...items];
    sortWorklistByRisk(items);
    expect(items).toEqual(copy);
  });
});

describe("sortWorklist", () => {
  it("sorts by name ascending", () => {
    const items = [
      item({ patientId: "1", name: "Zed" }),
      item({ patientId: "2", name: "Ann" }),
    ];
    expect(sortWorklist(items, "name", "asc").map((i) => i.name)).toEqual(["Ann", "Zed"]);
  });

  it("sorts by sepsis descending and treats missing as lowest", () => {
    const items = [
      item({ patientId: "1", sepsisScore: 0.2 }),
      item({ patientId: "2" }),
      item({ patientId: "3", sepsisScore: 0.8 }),
    ];
    expect(sortWorklist(items, "sepsis", "desc").map((i) => i.patientId)).toEqual(["3", "1", "2"]);
  });
});
