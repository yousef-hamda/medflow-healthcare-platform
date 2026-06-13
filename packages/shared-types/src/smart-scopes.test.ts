import { describe, expect, it } from "vitest";

import {
  formatSmartScope,
  hasFullFieldAccess,
  parseSmartScope,
  parseSmartScopes,
  scopesAllow,
} from "./smart-scopes.js";

describe("parseSmartScope", () => {
  it("parses patient/Observation.read", () => {
    expect(parseSmartScope("patient/Observation.read")).toEqual({
      context: "patient",
      resourceType: "Observation",
      permission: "read",
    });
  });

  it("parses wildcards user/*.*", () => {
    expect(parseSmartScope("user/*.*")).toEqual({
      context: "user",
      resourceType: "*",
      permission: "*",
    });
  });

  it("parses the MedFlow .full extension", () => {
    expect(parseSmartScope("user/Patient.full")).toEqual({
      context: "user",
      resourceType: "Patient",
      permission: "full",
    });
  });

  it.each([
    "launch",
    "openid",
    "patient/observation.read", // lowercase resource type
    "admin/Patient.read", // bad context
    "patient/Patient.execute", // bad permission
    "patient/Patient",
    "",
  ])("returns null for %j", (scope) => {
    expect(parseSmartScope(scope)).toBeNull();
  });
});

describe("parseSmartScopes", () => {
  it("splits a space-delimited scope string into categories", () => {
    const parsed = parseSmartScopes(
      "openid fhirUser launch/patient patient/Observation.read patient/*.read bogus offline_access",
    );
    expect(parsed.resourceScopes).toHaveLength(2);
    expect(parsed.specialScopes).toEqual(["openid", "fhirUser", "launch/patient", "offline_access"]);
    expect(parsed.unrecognized).toEqual(["bogus"]);
  });

  it("accepts an array and ignores empty entries", () => {
    const parsed = parseSmartScopes(["", "  ", "system/*.write"]);
    expect(parsed.resourceScopes).toEqual([
      { context: "system", resourceType: "*", permission: "write" },
    ]);
  });
});

describe("scopesAllow", () => {
  const granted = parseSmartScopes("patient/Observation.read user/Patient.full").resourceScopes;

  it("allows an exact match", () => {
    expect(
      scopesAllow(granted, { context: "patient", resourceType: "Observation", permission: "read" }),
    ).toBe(true);
  });

  it("treats .full as satisfying .read", () => {
    expect(
      scopesAllow(granted, { context: "user", resourceType: "Patient", permission: "read" }),
    ).toBe(true);
  });

  it("denies writes when only read was granted", () => {
    expect(
      scopesAllow(granted, { context: "patient", resourceType: "Observation", permission: "write" }),
    ).toBe(false);
  });

  it("wildcard resource and permission grant everything in context", () => {
    const all = parseSmartScopes("user/*.*").resourceScopes;
    expect(scopesAllow(all, { context: "user", resourceType: "Condition", permission: "write" })).toBe(
      true,
    );
    expect(
      scopesAllow(all, { context: "patient", resourceType: "Condition", permission: "read" }),
    ).toBe(false);
  });

  it("omitted context requirement matches any context", () => {
    expect(scopesAllow(granted, { resourceType: "Observation", permission: "read" })).toBe(true);
  });
});

describe("hasFullFieldAccess", () => {
  it("is true for .full and wildcard permission, false for plain read", () => {
    const full = parseSmartScopes("user/Patient.full").resourceScopes;
    const star = parseSmartScopes("user/*.*").resourceScopes;
    const read = parseSmartScopes("user/Patient.read").resourceScopes;
    expect(hasFullFieldAccess(full, "Patient")).toBe(true);
    expect(hasFullFieldAccess(star, "Patient")).toBe(true);
    expect(hasFullFieldAccess(read, "Patient")).toBe(false);
  });
});

describe("formatSmartScope", () => {
  it("round-trips", () => {
    const scope = parseSmartScope("patient/Condition.write");
    expect(scope).not.toBeNull();
    expect(formatSmartScope(scope!)).toBe("patient/Condition.write");
  });
});
