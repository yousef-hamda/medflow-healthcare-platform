"use client";

/**
 * The `mf_authed` cookie is a non-sensitive presence marker the middleware uses
 * to gate protected routes. The actual access token never leaves memory.
 */
export const AUTH_COOKIE = "mf_authed";

export function setAuthedCookie(): void {
  if (typeof document === "undefined") return;
  // Session cookie (no Expires) — cleared when the browser closes.
  document.cookie = `${AUTH_COOKIE}=1; Path=/; SameSite=Lax`;
}

export function clearAuthedCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
