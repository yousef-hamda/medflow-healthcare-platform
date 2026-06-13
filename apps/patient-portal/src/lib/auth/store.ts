import { create } from "zustand";

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  patientId?: string;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: PortalUser | null;
  setSession: (session: { accessToken: string; refreshToken?: string | null; user?: PortalUser | null }) => void;
  setUser: (user: PortalUser | null) => void;
  clearSession: () => void;
}

/**
 * In-memory auth store. Tokens are never persisted to localStorage (only the
 * `mf_authed` cookie set by the login flow gates routing). This keeps bearer
 * tokens out of disk while the SPA is alive.
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: null,
  user: null,
  setSession: ({ accessToken, refreshToken, user }) =>
    set((prev) => ({
      accessToken,
      refreshToken: refreshToken ?? prev.refreshToken,
      user: user ?? prev.user,
    })),
  setUser: (user) => set({ user }),
  clearSession: () => set({ accessToken: null, refreshToken: null, user: null }),
}));

/** Non-reactive accessor for use inside the fetch wrapper. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}

export function getRefreshToken(): string | null {
  return useAuthStore.getState().refreshToken;
}
