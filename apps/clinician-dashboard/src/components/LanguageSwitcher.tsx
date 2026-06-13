"use client";

import { Select } from "@medflow/ui";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useTransition, type ChangeEvent } from "react";

import { localeLabels, locales } from "@/i18n/routing";

/**
 * Swaps the leading locale segment of the current path. Because `localePrefix`
 * is "always", every route is prefixed with `/{locale}`. Updating it also flips
 * document direction via the [locale] layout on navigation.
 */
export function LanguageSwitcher(): JSX.Element {
  const t = useTranslations("nav");
  const activeLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const onChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    const nextLocale = event.target.value;
    const segments = (pathname || "/").split("/");
    // segments[0] is "" (leading slash); segments[1] is the locale.
    segments[1] = nextLocale;
    const nextPath = segments.join("/") || `/${nextLocale}`;
    startTransition(() => {
      router.replace(nextPath);
      router.refresh();
    });
  };

  return (
    <label className="inline-flex items-center gap-2">
      <span className="sr-only">{t("language")}</span>
      <Select
        aria-label={t("language")}
        value={activeLocale}
        onChange={onChange}
        disabled={isPending}
        className="h-9 w-auto min-w-[7rem]"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {localeLabels[loc]}
          </option>
        ))}
      </Select>
    </label>
  );
}
