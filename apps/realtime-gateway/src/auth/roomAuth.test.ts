/**
 * Unit tests for src/auth/roomAuth.ts
 *
 * All I/O is mocked — no network, no Redis, no Socket.IO.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authoriseRoomJoin,
  clearCareTeamCache,
  careTeamCache,
} from "./roomAuth.js";
import type { TokenClaims, FetchCareTeam, CareTeamResponse } from "./roomAuth.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaims(overrides: Partial<TokenClaims> = {}): TokenClaims {
  return {
    sub: "user-001",
    role: "clinician",
    scope: "user/Patient.read",
    ...overrides,
  };
}

function makeFetcher(patientIds: string[]): FetchCareTeam {
  return vi.fn().mockResolvedValue({ patientIds } satisfies CareTeamResponse);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authoriseRoomJoin — patient self-access", () => {
  beforeEach(() => clearCareTeamCache());

  it("allows when token.patient === patientId", async () => {
    const claims = makeClaims({ patient: "pt-42" });
    const fetch = makeFetcher([]);

    const decision = await authoriseRoomJoin(claims, "pt-42", "tok", fetch);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toMatch(/self/i);
    // No network call should have been made
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does NOT allow self-access when token.patient differs", async () => {
    const claims = makeClaims({ patient: "pt-99" });
    const fetch = makeFetcher(["pt-99"]); // user IS on the care team though

    const decision = await authoriseRoomJoin(claims, "pt-42", "tok", fetch);

    // Should fall through to care-team check — in this case they ARE on the team
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toMatch(/care-team/i);
  });
});

describe("authoriseRoomJoin — care-team membership", () => {
  beforeEach(() => clearCareTeamCache());

  it("allows a care-team member", async () => {
    const claims = makeClaims();
    const fetch = makeFetcher(["pt-1", "pt-2", "pt-3"]);

    const decision = await authoriseRoomJoin(claims, "pt-2", "tok", fetch);

    expect(decision.allowed).toBe(true);
    expect(decision.reason).toMatch(/care-team/i);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("denies a non-member", async () => {
    const claims = makeClaims();
    const fetch = makeFetcher(["pt-1", "pt-3"]);

    const decision = await authoriseRoomJoin(claims, "pt-99", "tok", fetch);

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not authorised/i);
  });

  it("denies when care-team is empty", async () => {
    const claims = makeClaims();
    const fetch = makeFetcher([]);

    const decision = await authoriseRoomJoin(claims, "pt-1", "tok", fetch);

    expect(decision.allowed).toBe(false);
  });
});

describe("authoriseRoomJoin — cache behaviour", () => {
  beforeEach(() => clearCareTeamCache());

  it("does not refetch within 60 seconds (cache hit)", async () => {
    const claims = makeClaims({ sub: "user-cache-test" });
    const fetch = makeFetcher(["pt-A", "pt-B"]);
    const now = Date.now();

    // First call — populates cache
    await authoriseRoomJoin(claims, "pt-A", "tok", fetch, now);
    // Second call within TTL — should use cache
    await authoriseRoomJoin(claims, "pt-B", "tok", fetch, now + 30_000);

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refetches after cache TTL expires (> 60s)", async () => {
    const claims = makeClaims({ sub: "user-cache-expiry" });
    const fetch = makeFetcher(["pt-A"]);
    const now = Date.now();

    // First call — populates cache
    await authoriseRoomJoin(claims, "pt-A", "tok", fetch, now);
    // Call after TTL — cache should be stale
    await authoriseRoomJoin(claims, "pt-A", "tok", fetch, now + 61_000);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cache is keyed per user — different users get separate fetches", async () => {
    const claimsA = makeClaims({ sub: "user-A" });
    const claimsB = makeClaims({ sub: "user-B" });
    const fetch = makeFetcher(["pt-1"]);
    const now = Date.now();

    await authoriseRoomJoin(claimsA, "pt-1", "tok", fetch, now);
    await authoriseRoomJoin(claimsB, "pt-1", "tok", fetch, now);

    // Two separate users → two fetches even if called at the same time
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cache entry is removed on expiry so next call re-populates", async () => {
    const claims = makeClaims({ sub: "user-rehydrate" });
    const fetch = makeFetcher(["pt-X"]);
    const now = Date.now();

    await authoriseRoomJoin(claims, "pt-X", "tok", fetch, now);
    expect(careTeamCache.has("user-rehydrate")).toBe(true);

    // Advance past TTL — next call should evict and repopulate
    await authoriseRoomJoin(claims, "pt-X", "tok", fetch, now + 65_000);
    expect(careTeamCache.has("user-rehydrate")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
