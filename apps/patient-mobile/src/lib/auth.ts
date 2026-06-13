/**
 * OAuth token lifecycle: password grant login, silent refresh (single-flight),
 * secure storage (expo-secure-store) and logout wipe.
 *
 * The pure logic lives in `createAuthClient` with injected dependencies so it
 * is unit-testable without native modules; the app uses the default singleton
 * exported at the bottom.
 */
import { createLogger } from "@/lib/logger";

const log = createLogger("auth");

export const TOKENS_KEY = "medflow.tokens.v1";
/** Refresh this long before the access token actually expires. */
export const REFRESH_SKEW_MS = 30_000;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms at which the access token expires. */
  expiresAt: number;
}

export interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface AuthDeps {
  baseUrl: string;
  clientId: string;
  storage: KeyValueStore;
  fetchFn: typeof fetch;
  now?: () => number;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly code: "invalid_credentials" | "refresh_failed" | "network",
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function tokenSetFromResponse(res: OAuthTokenResponse, nowMs: number): TokenSet {
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token,
    expiresAt: nowMs + res.expires_in * 1000,
  };
}

export function isAccessTokenFresh(tokens: TokenSet, nowMs: number): boolean {
  return tokens.expiresAt - nowMs > REFRESH_SKEW_MS;
}

export interface AuthClient {
  login(username: string, password: string): Promise<TokenSet>;
  /** Returns a usable access token, refreshing silently if needed; null = signed out. */
  getValidAccessToken(): Promise<string | null>;
  getTokens(): Promise<TokenSet | null>;
  /** Force a refresh (e.g. after a 401). Single-flight. */
  refresh(): Promise<TokenSet | null>;
  logout(): Promise<void>;
  hasSession(): Promise<boolean>;
}

export function createAuthClient(deps: AuthDeps): AuthClient {
  const now = deps.now ?? Date.now;
  let refreshInFlight: Promise<TokenSet | null> | null = null;

  async function saveTokens(tokens: TokenSet): Promise<void> {
    await deps.storage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  }

  async function loadTokens(): Promise<TokenSet | null> {
    const raw = await deps.storage.getItem(TOKENS_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as TokenSet;
      if (
        typeof parsed.accessToken !== "string" ||
        typeof parsed.refreshToken !== "string" ||
        typeof parsed.expiresAt !== "number"
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async function clearTokens(): Promise<void> {
    await deps.storage.removeItem(TOKENS_KEY);
  }

  async function tokenRequest(body: URLSearchParams): Promise<OAuthTokenResponse> {
    let response: Response;
    try {
      response = await deps.fetchFn(`${deps.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
    } catch (err) {
      log.warn("token endpoint unreachable", err);
      throw new AuthError("Token endpoint unreachable", "network");
    }
    if (!response.ok) {
      throw new AuthError(
        `Token request failed (${response.status})`,
        response.status === 400 || response.status === 401
          ? "invalid_credentials"
          : "network",
      );
    }
    return (await response.json()) as OAuthTokenResponse;
  }

  async function login(username: string, password: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: "password",
      username,
      password,
      client_id: deps.clientId,
      scope: "patient/*.read messaging.write offline_access",
    });
    const res = await tokenRequest(body);
    const tokens = tokenSetFromResponse(res, now());
    await saveTokens(tokens);
    log.info("login succeeded");
    return tokens;
  }

  async function doRefresh(): Promise<TokenSet | null> {
    const current = await loadTokens();
    if (!current) return null;
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: deps.clientId,
    });
    try {
      const res = await tokenRequest(body);
      const tokens = tokenSetFromResponse(res, now());
      await saveTokens(tokens);
      log.debug("silent refresh ok");
      return tokens;
    } catch (err) {
      if (err instanceof AuthError && err.code === "invalid_credentials") {
        // Refresh token revoked/expired — hard sign-out.
        log.warn("refresh token rejected; clearing session");
        await clearTokens();
        return null;
      }
      throw err;
    }
  }

  function refresh(): Promise<TokenSet | null> {
    refreshInFlight ??= doRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function getValidAccessToken(): Promise<string | null> {
    const tokens = await loadTokens();
    if (!tokens) return null;
    if (isAccessTokenFresh(tokens, now())) return tokens.accessToken;
    const refreshed = await refresh();
    return refreshed?.accessToken ?? null;
  }

  return {
    login,
    refresh,
    getValidAccessToken,
    getTokens: loadTokens,
    logout: async () => {
      await clearTokens();
      log.info("logout: tokens wiped");
    },
    hasSession: async () => (await loadTokens()) !== null,
  };
}
