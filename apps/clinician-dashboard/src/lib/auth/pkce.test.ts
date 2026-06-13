import { describe, expect, it } from "vitest";

import {
  base64UrlEncode,
  codeChallengeFromVerifier,
  generateCodeVerifier,
} from "./pkce";

describe("generateCodeVerifier", () => {
  it("produces a verifier within the RFC 7636 length range", () => {
    expect(generateCodeVerifier(64)).toHaveLength(64);
    // Clamped to [43, 128].
    expect(generateCodeVerifier(10).length).toBe(43);
    expect(generateCodeVerifier(200).length).toBe(128);
  });

  it("uses only unreserved URL-safe characters", () => {
    const verifier = generateCodeVerifier(128);
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it("is effectively unique across calls", () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });
});

describe("base64UrlEncode", () => {
  it("matches the RFC 4648 base64url known vector for ASCII bytes", () => {
    // "foobar" -> base64 "Zm9vYmFy" (no url-unsafe chars here).
    const bytes = new TextEncoder().encode("foobar");
    expect(base64UrlEncode(bytes)).toBe("Zm9vYmFy");
  });

  it("emits URL-safe output without padding", () => {
    const bytes = new Uint8Array([0xff, 0xff, 0xff, 0xfe]);
    const out = base64UrlEncode(bytes);
    expect(out).not.toContain("+");
    expect(out).not.toContain("/");
    expect(out).not.toContain("=");
  });
});

describe("codeChallengeFromVerifier", () => {
  it("matches the RFC 7636 Appendix B known vector", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = await codeChallengeFromVerifier(verifier);
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("round-trips: same verifier yields a stable challenge", async () => {
    const verifier = generateCodeVerifier(64);
    const a = await codeChallengeFromVerifier(verifier);
    const b = await codeChallengeFromVerifier(verifier);
    expect(a).toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9\-_]+$/);
  });
});
