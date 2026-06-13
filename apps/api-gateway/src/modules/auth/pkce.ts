/**
 * PKCE (Proof Key for Code Exchange) — RFC 7636
 * Supports S256 code challenge method only (plain is deprecated).
 */

import { createHash, randomBytes } from 'crypto';

/** Generates a cryptographically random code verifier (43–128 chars, base64url). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** Computes the S256 code challenge from a verifier. */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Verifies that the provided code_verifier matches the stored code_challenge.
 * Only S256 is accepted — plain is not supported per MedFlow security policy.
 */
export function verifyPkce(
  codeVerifier: string,
  storedChallenge: string,
  method: string,
): boolean {
  if (method !== 'S256') {
    return false;
  }
  const computed = computeCodeChallenge(codeVerifier);
  // Constant-time comparison to prevent timing attacks
  if (computed.length !== storedChallenge.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ storedChallenge.charCodeAt(i);
  }
  return diff === 0;
}
