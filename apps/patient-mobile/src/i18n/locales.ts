/** Supported locales and direction metadata. Pure module — safe in unit tests. */

export const LOCALES = ["en", "he", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

/** Native-language labels for the language picker. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  he: "עברית",
  ar: "العربية",
};

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["he", "ar"]);

export function isRTL(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

export function isSupportedLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
