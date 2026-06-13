/**
 * WebCrypto PKCE (RFC 7636) helpers. Pure and unit-testable; all functions
 * guard the absence of `crypto.subtle` (non-browser/insecure contexts).
 */

const UNRESERVED =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function getCrypto(): Crypto {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (!c || !c.getRandomValues) {
    throw new Error("WebCrypto is unavailable in this environment");
  }
  return c;
}

/** Base64url-encode raw bytes (no padding). */
export function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 1) {
    binary += String.fromCharCode(view[i] as number);
  }
  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(view).toString("base64");
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generates a high-entropy code verifier of `length` unreserved characters
 * (RFC 7636 allows 43..128). Defaults to 64.
 */
export function generateCodeVerifier(length = 64): string {
  const clamped = Math.max(43, Math.min(128, Math.floor(length)));
  const crypto = getCrypto();
  const random = new Uint8Array(clamped);
  crypto.getRandomValues(random);
  let verifier = "";
  for (let i = 0; i < clamped; i += 1) {
    verifier += UNRESERVED[(random[i] as number) % UNRESERVED.length];
  }
  return verifier;
}

/** S256 code challenge: base64url(SHA-256(verifier)). */
export async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const crypto = getCrypto();
  if (!crypto.subtle) {
    throw new Error("crypto.subtle is unavailable; cannot compute S256 challenge");
  }
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

/** Convenience: random state value for the OAuth redirect round-trip. */
export function generateState(length = 32): string {
  return generateCodeVerifier(length);
}
