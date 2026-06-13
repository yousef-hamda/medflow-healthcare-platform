import { describe, expect, it } from "vitest";

import { maskMrn, mrnLast4 } from "./mrn";

describe("maskMrn", () => {
  it("keeps the last four characters and masks the rest", () => {
    expect(maskMrn("MRN-00012345")).toBe("••••••••2345");
  });

  it("masks everything for short ids (<= 4 chars)", () => {
    expect(maskMrn("12")).toBe("••");
    expect(maskMrn("1234")).toBe("••••");
  });

  it("handles empty and nullish input", () => {
    expect(maskMrn("")).toBe("");
    expect(maskMrn(null)).toBe("");
    expect(maskMrn(undefined)).toBe("");
  });

  it("preserves overall length", () => {
    const mrn = "ABCDEFGHIJ";
    expect(maskMrn(mrn)).toHaveLength(mrn.length);
  });
});

describe("mrnLast4", () => {
  it("returns the last four characters", () => {
    expect(mrnLast4("MRN-9876")).toBe("9876");
  });
});
