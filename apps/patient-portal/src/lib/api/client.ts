import { apiUrl } from "@/lib/env";
import { getAccessToken, getRefreshToken, useAuthStore } from "@/lib/auth/store";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  /** Query params appended to the URL. */
  params?: Record<string, string | number | boolean | undefined>;
  /** Extra headers. */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** When false, the Authorization header is omitted. Default true. */
  auth?: boolean;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
}

function buildUrl(path: string, params?: RequestOptions["params"]): string {
  const base = path.startsWith("http") ? path : `${apiUrl()}${path.startsWith("/") ? "" : "/"}${path}`;
  if (!params) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function parseBody(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return res.json();
  }
  const text = await res.text();
  return text.length ? text : null;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Attempt a single token refresh. Returns true if a new access token was set. */
async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(buildUrl("/oauth/token"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grant_type: "refresh_token", refresh_token: refreshToken }),
        });
        if (!res.ok) return false;
        const data = (await res.json()) as TokenResponse;
        if (!data.access_token) return false;
        useAuthStore.getState().setSession({
          accessToken: data.access_token,
          refreshToken: data.refresh_token ?? refreshToken,
        });
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  const { params, headers, signal, auth = true } = options;

  const doFetch = async (): Promise<Response> => {
    const finalHeaders: Record<string, string> = {
      accept: "application/json",
      ...headers,
    };
    if (body !== undefined && !(body instanceof FormData)) {
      finalHeaders["content-type"] = "application/json";
    }
    if (auth) {
      const token = getAccessToken();
      if (token) finalHeaders.authorization = `Bearer ${token}`;
    }
    return fetch(buildUrl(path, params), {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal,
    });
  };

  let res = await doFetch();

  // 401 -> refresh once and retry.
  if (res.status === 401 && auth) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    const errBody = await parseBody(res).catch(() => null);
    const message =
      (typeof errBody === "object" && errBody !== null && "message" in errBody && typeof (errBody as { message: unknown }).message === "string"
        ? (errBody as { message: string }).message
        : undefined) ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message, errBody);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await parseBody(res)) as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> => request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> => request<T>("PUT", path, body, options),
  del: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>("DELETE", path, undefined, options),
};
