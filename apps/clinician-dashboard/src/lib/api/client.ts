import { env } from "@/lib/env";
import { getAuthSnapshot, useAuthStore } from "@/lib/auth/store";
import { refreshAccessToken } from "@/lib/auth/smart";

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  /** Query params appended to the URL. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Extra headers. */
  headers?: Record<string, string>;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Override the base URL (e.g. for the CDS service). */
  baseUrl?: string;
  /** Skip the Authorization header (public endpoints). */
  anonymous?: boolean;
}

function buildUrl(path: string, baseUrl: string, query?: RequestOptions["query"]): string {
  const url = new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
}

async function doFetch(
  method: string,
  path: string,
  options: RequestOptions,
  body: unknown,
  retryOn401: boolean,
): Promise<Response> {
  const baseUrl = options.baseUrl ?? env.apiUrl;
  const url = buildUrl(path, baseUrl, options.query);

  const headers: Record<string, string> = {
    accept: "application/json",
    ...options.headers,
  };

  let serializedBody: BodyInit | undefined;
  if (body !== undefined && body !== null) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
    serializedBody =
      headers["content-type"].includes("application/json") && typeof body !== "string"
        ? JSON.stringify(body)
        : (body as BodyInit);
  }

  if (!options.anonymous) {
    const session = getAuthSnapshot();
    if (session?.accessToken) {
      headers.authorization = `${session.tokenType ?? "Bearer"} ${session.accessToken}`;
    }
  }

  const res = await fetch(url, {
    method,
    headers,
    body: serializedBody,
    signal: options.signal,
  });

  // One-shot refresh on 401.
  if (res.status === 401 && retryOn401 && !options.anonymous) {
    const session = getAuthSnapshot();
    if (session?.refreshToken) {
      try {
        const refreshed = await refreshAccessToken(session.refreshToken);
        useAuthStore.getState().setSession({ ...session, ...refreshed });
        return doFetch(method, path, options, body, false);
      } catch {
        useAuthStore.getState().clearSession();
      }
    }
  }

  return res;
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
  body?: unknown,
): Promise<T> {
  const res = await doFetch(method, path, options, body, true);
  const parsed = await parseBody(res);
  if (!res.ok) {
    const message =
      typeof parsed === "object" && parsed !== null && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : `${method} ${path} failed with ${res.status}`;
    throw new ApiError(message, res.status, parsed);
  }
  return parsed as T;
}

export const apiClient = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("GET", path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>("POST", path, options, body),
  put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>("PUT", path, options, body),
  del: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>("DELETE", path, options),
};

export type ApiClient = typeof apiClient;
