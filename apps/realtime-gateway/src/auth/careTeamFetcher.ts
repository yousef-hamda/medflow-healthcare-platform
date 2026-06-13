/**
 * HTTP client for the care-team membership endpoint on api-gateway.
 *
 * GET {API_GATEWAY_URL}/users/me/care-team
 * Authorization: Bearer <token>
 *
 * Expected response shape (additional fields are ignored):
 *   { "patientIds": ["p1", "p2", ...] }
 *
 * Throws on non-2xx status or network error so the authoriser can propagate
 * the denial upstream.
 */

import type { FetchCareTeam, CareTeamResponse } from "./roomAuth.js";
import type { Logger } from "../logger.js";

// Use the global fetch available in Node 20+; no additional import needed.

/**
 * Builds a real HTTP care-team fetcher bound to a specific api-gateway URL.
 */
export function buildCareTeamFetcher(apiGatewayUrl: string, logger: Logger): FetchCareTeam {
  return async (bearerToken: string, userId: string): Promise<CareTeamResponse> => {
    const url = `${apiGatewayUrl}/users/me/care-team`;
    logger.debug({ userId, url }, "Fetching care-team membership");

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(
        `care-team fetch failed: HTTP ${res.status.toString()} ${res.statusText} for userId=${userId}`,
      );
    }

    const body = (await res.json()) as { patientIds?: unknown };

    if (!Array.isArray(body.patientIds)) {
      logger.warn({ userId }, "care-team response missing patientIds array; defaulting to []");
      return { patientIds: [] };
    }

    const patientIds = (body.patientIds as unknown[]).filter(
      (id): id is string => typeof id === "string",
    );

    return { patientIds };
  };
}
