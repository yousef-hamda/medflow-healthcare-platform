import { z } from "zod";

export const SHARE_SCOPES = ["labs", "medications", "vitals", "conditions", "allergies"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];

/** Maximum allowed lifetime for a share token, in hours. */
export const MAX_SHARE_HOURS = 72;

export const ShareFormSchema = z
  .object({
    scopes: z
      .array(z.enum(SHARE_SCOPES))
      .min(1, { message: "scopeError" }),
    /** Lifetime in hours; must be a positive value no greater than 72. */
    expiresInHours: z
      .number()
      .int()
      .positive()
      .max(MAX_SHARE_HOURS, { message: "expiryError" }),
  })
  .strict();

export type ShareFormValues = z.infer<typeof ShareFormSchema>;

export interface ShareValidationResult {
  success: boolean;
  /** i18n keys ("scopeError" | "expiryError") for failed fields. */
  errors: { scopes?: string; expiresInHours?: string };
  data?: ShareFormValues & { expiresAt: string };
}

/**
 * Validates a share form. On success, computes the absolute `expiresAt`
 * timestamp (now + expiresInHours) and confirms it is within 72h and in the
 * future.
 */
export function validateShareForm(input: { scopes: readonly string[]; expiresInHours: number }, now: Date = new Date()): ShareValidationResult {
  const parsed = ShareFormSchema.safeParse({
    scopes: input.scopes,
    expiresInHours: input.expiresInHours,
  });

  if (!parsed.success) {
    const errors: ShareValidationResult["errors"] = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "scopes") errors.scopes = issue.message;
      if (field === "expiresInHours") errors.expiresInHours = issue.message;
    }
    return { success: false, errors };
  }

  const expiresAtMs = now.getTime() + parsed.data.expiresInHours * 60 * 60 * 1000;
  const maxMs = now.getTime() + MAX_SHARE_HOURS * 60 * 60 * 1000;

  // Defensive: must be in the future and within the 72h ceiling.
  if (expiresAtMs <= now.getTime()) {
    return { success: false, errors: { expiresInHours: "expiryError" } };
  }
  if (expiresAtMs > maxMs) {
    return { success: false, errors: { expiresInHours: "expiryError" } };
  }

  return {
    success: true,
    errors: {},
    data: { ...parsed.data, expiresAt: new Date(expiresAtMs).toISOString() },
  };
}
