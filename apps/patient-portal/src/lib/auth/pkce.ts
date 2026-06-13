/**
 * WebCrypto PKCE helpers (RFC 7636, S256).
 * All functions are SSR-guarded: they throw a clear error if called where
 * `crypto.subtle` is unavailable, so callers only invoke them in the browser.
 */

function getCrypto(): Crypto {
  if (typeof globalThis === "undefined" || !globalThis.crypto?.subtle) {
    throw new Error("PKCE requires the WebCrypto API (call from the browser).");
  }
  return globalThis.crypto;
}

/** Base64url-encode an ArrayBuffer without padding. */
export function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Generate a high-entropy code verifier (43-128 chars). */
export function generateCodeVerifier(length = 64): string {
  const c = getCrypto();
  const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const random = new Uint8Array(length);
  c.getRandomValues(random);
  let verifier = "";
  for (let i = 0; i < length; i++) {
    verifier += charset[random[i] % charset.length];
  }
  return verifier;
}

/** Derive the S256 code challenge from a verifier. */
export async function codeChallengeFromVerifier(verifier: string): Promise<string> {
  const c = getCrypto();
  const data = new TextEncoder().encode(verifier);
  const digest = await c.subtle.digest("SHA-256", data);
  return base64url(digest);
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** Convenience: produce a verifier + its S256 challenge. */
export async function createPkcePair(): Promise<PkcePair> {
  const verifier = generateCodeVerifier();
  const challenge = await codeChallengeFromVerifier(verifier);
  return { verifier, challenge, method: "S256" };
}

/** Generate a random opaque state value for CSRF protection. */
export function generateState(length = 32): string {
  return generateCodeVerifier(length);
}
