import { env } from "@/lib/env";
import {
  codeChallengeFromVerifier,
  generateCodeVerifier,
  generateState,
} from "@/lib/auth/pkce";
import type { AuthSession } from "@/lib/auth/store";

/**
 * SMART on FHIR app-launch helpers (standalone + EHR launch) using the gateway
 * OAuth endpoints with PKCE S256.
 */

export const SMART_CLIENT_ID = "medflow-clinician-dashboard";
export const SMART_SCOPES =
  "openid fhirUser launch patient/*.read user/*.read offline_access";

const VERIFIER_KEY = "medflow.smart.verifier";
const STATE_KEY = "medflow.smart.state";
const ISS_KEY = "medflow.smart.iss";

export interface SmartLaunchParams {
  iss: string | null;
  launch: string | null;
}

/** Reads SMART launch params (`iss`, `launch`) from a URLSearchParams. */
export function parseSmartLaunch(params: URLSearchParams): SmartLaunchParams {
  return { iss: params.get("iss"), launch: params.get("launch") };
}

function redirectUri(): string {
  if (typeof window === "undefined") return "http://localhost:3000/callback";
  return `${window.location.origin}/callback`;
}

/**
 * Builds the authorize URL, persisting verifier/state to sessionStorage for the
 * redirect round-trip. Authorization Code + PKCE; `aud` is the FHIR issuer.
 */
export async function buildAuthorizeUrl(launch: SmartLaunchParams): Promise<string> {
  const verifier = generateCodeVerifier(64);
  const state = generateState(32);
  const challenge = await codeChallengeFromVerifier(verifier);
  const aud = launch.iss ?? env.apiUrl;

  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(VERIFIER_KEY, verifier);
    window.sessionStorage.setItem(STATE_KEY, state);
    window.sessionStorage.setItem(ISS_KEY, aud);
  }

  const query = new URLSearchParams({
    response_type: "code",
    client_id: SMART_CLIENT_ID,
    redirect_uri: redirectUri(),
    scope: SMART_SCOPES,
    state,
    aud,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (launch.launch) query.set("launch", launch.launch);

  return `${env.apiUrl}/oauth/authorize?${query.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

function toSession(token: TokenResponse): AuthSession {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: token.token_type ?? "Bearer",
    scope: token.scope,
    expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
  };
}

/** Exchanges an authorization code (+ stored verifier) for tokens. */
export async function exchangeCodeForToken(
  code: string,
  returnedState: string | null,
): Promise<AuthSession> {
  if (typeof window === "undefined") {
    throw new Error("Token exchange must run in the browser");
  }
  const verifier = window.sessionStorage.getItem(VERIFIER_KEY);
  const expectedState = window.sessionStorage.getItem(STATE_KEY);
  if (!verifier) throw new Error("Missing PKCE verifier for token exchange");
  if (expectedState && returnedState && expectedState !== returnedState) {
    throw new Error("OAuth state mismatch — possible CSRF");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: SMART_CLIENT_ID,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });

  const res = await fetch(`${env.apiUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status})`);
  const token = (await res.json()) as TokenResponse;

  window.sessionStorage.removeItem(VERIFIER_KEY);
  window.sessionStorage.removeItem(STATE_KEY);
  return toSession(token);
}

/** Exchanges a refresh token for a fresh access token. */
export async function refreshAccessToken(refreshToken: string): Promise<AuthSession> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: SMART_CLIENT_ID,
  });
  const res = await fetch(`${env.apiUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token refresh failed (${res.status})`);
  const token = (await res.json()) as TokenResponse;
  // Preserve the old refresh token if the server didn't rotate it.
  const session = toSession(token);
  if (!session.refreshToken) session.refreshToken = refreshToken;
  return session;
}
