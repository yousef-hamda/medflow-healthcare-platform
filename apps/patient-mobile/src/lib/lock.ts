/**
 * App lock policy: after the app spends more than LOCK_AFTER_MS in the
 * background, re-entry must be gated by biometrics (or PIN fallback).
 */

export const LOCK_AFTER_MS = 2 * 60 * 1000; // 2 minutes per spec

export function shouldLock(
  backgroundedAt: number | null,
  nowMs: number,
  biometricOrPinEnabled: boolean,
): boolean {
  if (!biometricOrPinEnabled) return false;
  if (backgroundedAt === null) return false;
  return nowMs - backgroundedAt >= LOCK_AFTER_MS;
}
