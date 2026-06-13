import { z } from "zod";

/**
 * Public, build-time environment for the patient portal.
 * Only NEXT_PUBLIC_* values are accessible client-side; we read them eagerly so
 * Next can statically inline them.
 */
const EnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_REALTIME_URL: z.string().url().default("http://localhost:4001"),
});

const parsed = EnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
});

if (!parsed.success) {
  // Fall back to defaults but surface the problem in development.
  // eslint-disable-next-line no-console
  console.warn("[env] Invalid NEXT_PUBLIC environment, using defaults:", parsed.error.flatten().fieldErrors);
}

const env = parsed.success
  ? parsed.data
  : EnvSchema.parse({});

export const apiUrl = (): string => env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
export const realtimeUrl = (): string => env.NEXT_PUBLIC_REALTIME_URL.replace(/\/$/, "");
