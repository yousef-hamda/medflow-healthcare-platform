"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { Condition, MedicationRequest } from "@medflow/fhir-types";
import { Badge, buttonVariants, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, Skeleton } from "@medflow/ui";
import { PageHeader } from "@/components/PageHeader";
import { useMyAllergies, useMyConditions, useMyMedications, useUserMe } from "@/lib/api/hooks";
import { SYNTHETIC_ALLERGIES } from "@/lib/synthetic";
import { formatDate } from "@/lib/dates";

function conditionLabel(c: Condition): string {
  return c.code?.text ?? c.code?.coding?.[0]?.display ?? "Condition";
}

function medicationLabel(m: MedicationRequest): string {
  return (
    m.medicationCodeableConcept?.text ??
    m.medicationCodeableConcept?.coding?.[0]?.display ??
    m.medicationReference?.display ??
    "Medication"
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const t = useTranslations("overview");
  const locale = useLocale();
  const me = useUserMe();
  const conditions = useMyConditions();
  const medications = useMyMedications();
  const allergies = useMyAllergies();

  const allergyList = allergies.data && allergies.data.length > 0 ? allergies.data : SYNTHETIC_ALLERGIES;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        subtitle={me.data ? t("greeting", { name: me.data.name }) : undefined}
        action={
          <Link href={`/${locale}/me/results`} className={buttonVariants({ variant: "outline" })}>
            {t("viewResults")}
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("problems")}</CardTitle>
          </CardHeader>
          <CardContent>
            {conditions.isLoading ? (
              <SectionSkeleton />
            ) : conditions.data && conditions.data.length > 0 ? (
              <ul className="divide-y divide-border">
                {conditions.data.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="font-medium">{conditionLabel(c)}</span>
                    {c.onsetDateTime ? (
                      <span className="text-xs text-muted-foreground">{t("since", { date: formatDate(c.onsetDateTime, locale) })}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t("problemsEmpty")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("medications")}</CardTitle>
          </CardHeader>
          <CardContent>
            {medications.isLoading ? (
              <SectionSkeleton />
            ) : medications.data && medications.data.length > 0 ? (
              <ul className="divide-y divide-border">
                {medications.data.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="font-medium">{medicationLabel(m)}</span>
                    {m.dosageInstruction?.[0]?.text ? (
                      <span className="text-xs text-muted-foreground">{m.dosageInstruction[0].text}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t("medicationsEmpty")} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("allergies")}</CardTitle>
            <CardDescription>{/* allergies derived from AllergyIntolerance or synthetic fallback */}</CardDescription>
          </CardHeader>
          <CardContent>
            {allergies.isLoading ? (
              <SectionSkeleton />
            ) : allergyList.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {allergyList.map((a) => (
                  <li key={a.id}>
                    <Badge variant="warning" className="text-sm">
                      {a.substance}
                      {a.reaction ? <span className="font-normal opacity-90">· {a.reaction}</span> : null}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t("allergiesEmpty")} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
