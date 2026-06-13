"use client";

import { useTranslations } from "next-intl";

import { CohortBuilder } from "@/components/CohortBuilder";

export default function CohortPage(): JSX.Element {
  const t = useTranslations("cohort");
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      <CohortBuilder />
    </section>
  );
}
