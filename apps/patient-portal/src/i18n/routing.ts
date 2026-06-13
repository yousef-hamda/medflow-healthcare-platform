export const locales = ["en", "he", "ar"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localePrefix = "always" as const;

export type Direction = "ltr" | "rtl";

/** Returns the writing direction for a given locale. */
export function localeDirection(locale: string): Direction {
  return locale === "he" || locale === "ar" ? "rtl" : "ltr";
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
