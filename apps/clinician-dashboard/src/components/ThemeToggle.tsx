"use client";

import { Button, useTheme } from "@medflow/ui";
import { useTranslations } from "next-intl";

/** Cycles light → dark → system. Announces the current theme to assistive tech. */
export function ThemeToggle(): JSX.Element {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const t = useTranslations("theme");

  const next = theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
  const label = `${t("toggle")} (${t(theme)})`;

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
    >
      {resolvedTheme === "dark" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </Button>
  );
}
