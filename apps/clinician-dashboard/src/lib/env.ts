import { z } from "zod";

/**
 * Typed, validated access to public runtime configuration.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, so these must be
 * referenced statically (not via dynamic keys) to be replaced correctly.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  NEXT_PUBLIC_REALTIME_URL: z.string().url(),
  NEXT_PUBLIC_CDS_URL: z.string().url(),
});

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL ?? "http://localhost:4001",
  NEXT_PUBLIC_CDS_URL: process.env.NEXT_PUBLIC_CDS_URL ?? "http://localhost:8096",
});

if (!parsed.success) {
  // Surface a clear message during development; fall back to defaults so the
  // route-mocked test/e2e flows still render with no backend.
  // eslint-disable-next-line no-console
  console.warn("Invalid NEXT_PUBLIC_* env, using defaults:", parsed.error.flatten().fieldErrors);
}

const values = parsed.success
  ? parsed.data
  : {
      NEXT_PUBLIC_API_URL: "http://localhost:4000",
      NEXT_PUBLIC_REALTIME_URL: "http://localhost:4001",
      NEXT_PUBLIC_CDS_URL: "http://localhost:8096",
    };

export const env = {
  apiUrl: values.NEXT_PUBLIC_API_URL,
  realtimeUrl: values.NEXT_PUBLIC_REALTIME_URL,
  cdsUrl: values.NEXT_PUBLIC_CDS_URL,
} as const;

export type Env = typeof env;
