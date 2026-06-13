import { useAuthStore, type PortalUser } from "@/lib/auth/store";

const AUTH_COOKIE = "mf_authed";

/**
 * Establishes a client-side mock session: sets the `mf_authed` cookie the
 * middleware checks, and stores an in-memory bearer token. The real flow would
 * instead exchange an OAuth code; here we mint a synthetic token for the demo.
 */
export function startMockSession(user: PortalUser, accessToken = `mock.${crypto.randomUUID()}`): void {
  // Cookie lasts the browser session (no Max-Age) so it clears on close.
  document.cookie = `${AUTH_COOKIE}=1; path=/; SameSite=Lax`;
  useAuthStore.getState().setSession({ accessToken, refreshToken: null, user });
}

export function clearMockSession(): void {
  document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  useAuthStore.getState().clearSession();
}
