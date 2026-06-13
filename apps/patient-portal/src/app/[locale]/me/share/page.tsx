"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/PageHeader";
import { ShareForm } from "@/components/ShareForm";

export default function SharePage() {
  const t = useTranslations("share");
  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <ShareForm />
    </div>
  );
}
