"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@medflow/ui";
import type { ResultFlag } from "@/lib/labs";

/**
 * Renders a lab result flag. Critically, it never relies on color alone:
 * an arrow icon + text label communicate the flag for accessibility.
 */
export function FlagBadge({ flag }: { flag: ResultFlag }) {
  const t = useTranslations("results");

  if (flag === "normal") {
    return (
      <Badge variant="success">
        <CheckIcon />
        {t("flagNormal")}
      </Badge>
    );
  }
  if (flag === "high") {
    return (
      <Badge variant="warning">
        <ArrowIcon up />
        {t("flagHigh")}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <ArrowIcon />
      {t("flagLow")}
    </Badge>
  );
}

function ArrowIcon({ up = false }: { up?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
      {up ? (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0-6 6m6-6 6 6" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0 6-6m-6 6-6-6" />
      )}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
    </svg>
  );
}
