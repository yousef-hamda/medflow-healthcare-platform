"use client";

import { create } from "zustand";

import type { CurrentUser } from "@/lib/api/types";

/**
 * Auth session lives in-memory only (never localStorage) to limit token
 * exposure. The PKCE verifier/state are persisted to sessionStorage solely for
 * the redirect round-trip (see smart.ts).
 */
export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires. */
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  user?: CurrentUser;
}

interface AuthState {
  session: AuthSession | null;
  setSession: (session: AuthSession) => void;
  setUser: (user: CurrentUser) => void;
  clearSession: () => void;
  getAccessToken: () => string | null;
  isExpired: () => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  setSession: (session) => set({ session }),
  setUser: (user) =>
    set((state) => (state.session ? { session: { ...state.session, user } } : {})),
  clearSession: () => set({ session: null }),
  getAccessToken: () => get().session?.accessToken ?? null,
  isExpired: () => {
    const { session } = get();
    if (!session?.expiresAt) return false;
    // 15s safety margin.
    return Date.now() >= session.expiresAt - 15_000;
  },
}));

/** Non-hook accessor for use inside the plain fetch client. */
export function getAuthSnapshot(): AuthSession | null {
  return useAuthStore.getState().session;
}
