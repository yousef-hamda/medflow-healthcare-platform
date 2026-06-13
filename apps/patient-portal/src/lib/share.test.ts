import { describe, expect, it } from "vitest";
import { validateShareForm, MAX_SHARE_HOURS } from "./share";

const NOW = new Date("2026-06-11T12:00:00.000Z");

describe("validateShareForm", () => {
  it("rejects when no scope is selected", () => {
    const result = validateShareForm({ scopes: [], expiresInHours: 24 }, NOW);
    expect(result.success).toBe(false);
    expect(result.errors.scopes).toBe("scopeError");
  });

  it("rejects expiry greater than 72 hours", () => {
    const result = validateShareForm({ scopes: ["labs"], expiresInHours: 96 }, NOW);
    expect(result.success).toBe(false);
    expect(result.errors.expiresInHours).toBe("expiryError");
  });

  it("rejects non-positive expiry", () => {
    const result = validateShareForm({ scopes: ["labs"], expiresInHours: 0 }, NOW);
    expect(result.success).toBe(false);
  });

  it("rejects unknown scope values", () => {
    const result = validateShareForm({ scopes: ["something-else"], expiresInHours: 24 }, NOW);
    expect(result.success).toBe(false);
  });

  it("accepts a valid form and computes expiresAt in the future", () => {
    const result = validateShareForm({ scopes: ["labs", "vitals"], expiresInHours: 24 }, NOW);
    expect(result.success).toBe(true);
    expect(result.data?.scopes).toEqual(["labs", "vitals"]);
    const expires = new Date(result.data!.expiresAt).getTime();
    expect(expires).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
    expect(expires).toBeGreaterThan(NOW.getTime());
  });

  it("accepts exactly the maximum 72h boundary", () => {
    const result = validateShareForm({ scopes: ["medications"], expiresInHours: MAX_SHARE_HOURS }, NOW);
    expect(result.success).toBe(true);
  });
});
