/**
 * Redacting logger — the ONLY sanctioned way to log in this app.
 *
 * Healthcare apps must never write PHI to device logs (logcat / os_log are
 * readable by other tooling and end up in bug reports). This logger:
 *   1. redacts values for a denylist of sensitive keys (recursively),
 *   2. redacts strings that look like emails, phone numbers, MRNs or JWTs,
 *   3. is a no-op below `warn` in production builds.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const SENSITIVE_KEY_PATTERN =
  /(name|email|phone|address|birth|dob|mrn|ssn|patient|token|password|secret|authorization|pin|note|body|message|subject|value)/i;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const JWT_RE = /\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g;
const PHONE_RE = /\+?\d[\d\s().-]{7,}\d/g;

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 6;

export function redactString(value: string): string {
  return value
    .replace(JWT_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(PHONE_RE, REDACTED);
}

export function redact(input: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[MaxDepth]";
  if (input == null) return input;
  if (typeof input === "string") return redactString(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (input instanceof Error) {
    return { name: input.name, message: redactString(input.message) };
  }
  if (Array.isArray(input)) return input.map((v) => redact(v, depth + 1));
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(value, depth + 1);
    }
    return out;
  }
  return String(input);
}

function emit(level: LogLevel, tag: string, message: string, meta?: unknown): void {
  const isProd =
    typeof __DEV__ !== "undefined" ? !__DEV__ : process.env.NODE_ENV === "production";
  if (isProd && (level === "debug" || level === "info")) return;

  const line = `[medflow:${tag}] ${redactString(message)}`;
  const safeMeta = meta === undefined ? undefined : redact(meta);
  const fn =
    level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (safeMeta === undefined) fn(line);
  else fn(line, safeMeta);
}

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(tag: string): Logger {
  return {
    debug: (m, meta) => emit("debug", tag, m, meta),
    info: (m, meta) => emit("info", tag, m, meta),
    warn: (m, meta) => emit("warn", tag, m, meta),
    error: (m, meta) => emit("error", tag, m, meta),
  };
}
