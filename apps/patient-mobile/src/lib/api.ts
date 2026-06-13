/**
 * Authenticated fetch wrapper for the MedFlow gateway.
 * Attaches the bearer token, retries once after a silent refresh on 401.
 */
import { createAuthClient, type AuthClient } from "@/lib/auth";
import { API_URL, OAUTH_CLIENT_ID } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { secureStorage } from "@/lib/secureStorage";

const log = createLogger("api");

export const authClient: AuthClient = createAuthClient({
  baseUrl: API_URL,
  clientId: OAUTH_CLIENT_ID,
  storage: secureStorage,
  fetchFn: fetch,
});

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}`);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

async function rawRequest(
  path: string,
  token: string | null,
  options: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let token = await authClient.getValidAccessToken();
  let response = await rawRequest(path, token, options);

  if (response.status === 401) {
    log.debug("401 — attempting silent refresh", { path });
    const refreshed = await authClient.refresh();
    token = refreshed?.accessToken ?? null;
    if (token) response = await rawRequest(path, token, options);
  }

  if (!response.ok) {
    throw new ApiError(response.status, path);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
