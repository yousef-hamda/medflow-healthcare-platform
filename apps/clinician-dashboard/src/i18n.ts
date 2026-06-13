import { getRequestConfig } from "next-intl/server";

import enMessages from "../messages/en.json";
import { defaultLocale, isLocale } from "@/i18n/routing";

type Messages = Record<string, unknown>;

/**
 * Deep-merge locale messages over the English base so that medical/long-form
 * strings (kept English-only by design) resolve everywhere, while translated
 * namespaces (nav/common/risk/…) override per locale.
 */
function deepMerge(base: Messages, override: Messages): Messages {
  const out: Messages = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = out[key];
    if (
      existing &&
      typeof existing === "object" &&
      !Array.isArray(existing) &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      out[key] = deepMerge(existing as Messages, value as Messages);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export default getRequestConfig(async ({ locale }) => {
  const resolved = isLocale(locale) ? locale : defaultLocale;

  const localeMessages =
    resolved === defaultLocale
      ? (enMessages as Messages)
      : deepMerge(
          enMessages as Messages,
          (await import(`../messages/${resolved}.json`)).default as Messages,
        );

  return {
    messages: localeMessages,
    formats: {
      dateTime: {
        short: { day: "2-digit", month: "short", year: "numeric" },
      },
    },
  };
});
