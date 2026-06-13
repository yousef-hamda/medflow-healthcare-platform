export const locales = ["en", "he", "ar"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localePrefix = "always" as const;

const RTL_LOCALES: ReadonlySet<string> = new Set(["he", "ar"]);

/** Reading direction for a locale. Hebrew and Arabic are right-to-left. */
export function localeDirection(locale: string): "rtl" | "ltr" {
  return RTL_LOCALES.has(locale) ? "rtl" : "ltr";
}

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

/** Human-readable, autonym labels for the language switcher. */
export const localeLabels: Record<Locale, string> = {
  en: "English",
  he: "עברית",
  ar: "العربية",
};
