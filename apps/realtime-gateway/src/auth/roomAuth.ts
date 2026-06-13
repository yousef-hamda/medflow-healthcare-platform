/**
 * Room authorisation — pure decision logic, fully unit-testable.
 *
 * IO boundary: a single async `fetchCareTeam` function injected at call time;
 * tests pass a mock, production passes the real HTTP fetcher.
 *
 * Cache: a simple TTL map keyed by userId so repeated "join" events within
 * 60 seconds do not hammer the api-gateway care-team endpoint.
 */

export interface TokenClaims {
  /** Subject — user id. */
  sub: string;
  role: string;
  scope: string;
  /** For patient-role tokens: the patient's own id. */
  patient?: string;
}

/**
 * Minimal interface the authoriser expects back from the care-team API.
 * The real response may have more fields; only `patientIds` is used.
 */
export interface CareTeamResponse {
  patientIds: string[];
}

/**
 * Function type for fetching care-team membership.
 * Receives the bearer token so the upstream can enforce its own authz.
 * Should resolve to the list of patient ids the user is authorised for,
 * or throw on network/auth error.
 */
export type FetchCareTeam = (bearerToken: string, userId: string) => Promise<CareTeamResponse>;

/** Authorisation decision returned to the caller. */
export type AuthDecision =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string };

// ---------------------------------------------------------------------------
// Internal TTL cache
// ---------------------------------------------------------------------------

interface CacheEntry {
  patientIds: string[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds

/**
 * In-process TTL cache for care-team lookups.
 * Exported so tests can inspect / reset it.
 */
export const careTeamCache = new Map<string, CacheEntry>();

/** Clear all cached entries (used in tests). */
export function clearCareTeamCache(): void {
  careTeamCache.clear();
}

/**
 * Get cached patient ids for a user, or undefined if missing / expired.
 */
function getCached(userId: string, nowMs: number): string[] | undefined {
  const entry = careTeamCache.get(userId);
  if (!entry) return undefined;
  if (nowMs >= entry.expiresAt) {
    careTeamCache.delete(userId);
    return undefined;
  }
  return entry.patientIds;
}

/** Store a care-team result in the cache. */
function setCached(userId: string, patientIds: string[], nowMs: number): void {
  careTeamCache.set(userId, { patientIds, expiresAt: nowMs + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Public decision function
// ---------------------------------------------------------------------------

/**
 * Decides whether `claims` may join room `patient:{patientId}`.
 *
 * Rules (evaluated in order):
 *  1. Patient self-access — token.patient === patientId → allow without network call.
 *  2. Care-team member — fetch (or replay from cache) the user's care team;
 *     allow if patientId is in the list.
 *  3. Otherwise deny.
 *
 * @param claims      Decoded JWT payload.
 * @param patientId   The patient id extracted from the requested room.
 * @param bearerToken Raw "Bearer …" token forwarded to care-team API.
 * @param fetchCareTeam Injected async function to retrieve care-team membership.
 * @param nowMs       Current epoch ms (injectable for deterministic tests).
 */
export async function authoriseRoomJoin(
  claims: TokenClaims,
  patientId: string,
  bearerToken: string,
  fetchCareTeam: FetchCareTeam,
  nowMs: number = Date.now(),
): Promise<AuthDecision> {
  // Rule 1: patient self-access
  if (claims.patient !== undefined && claims.patient === patientId) {
    return { allowed: true, reason: "patient self-access" };
  }

  // Rule 2: care-team membership
  const userId = claims.sub;

  let patientIds = getCached(userId, nowMs);

  if (patientIds === undefined) {
    // Cache miss — fetch from api-gateway
    const response = await fetchCareTeam(bearerToken, userId);
    patientIds = response.patientIds;
    setCached(userId, patientIds, nowMs);
  }

  if (patientIds.includes(patientId)) {
    return { allowed: true, reason: "care-team member" };
  }

  return { allowed: false, reason: "not authorised for this patient" };
}
