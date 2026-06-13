"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Patient } from "@medflow/fhir-types";
import { Card, CardContent, EmptyState, Skeleton } from "@medflow/ui";
import { PageHeader } from "@/components/PageHeader";
import { useMyPatient, useUserMe } from "@/lib/api/hooks";
import { formatDate } from "@/lib/dates";

function patientName(p: Patient | undefined, fallback: string): string {
  const n = p?.name?.[0];
  if (!n) return fallback;
  return n.text ?? [n.given?.join(" "), n.family].filter(Boolean).join(" ") || fallback;
}

function patientPhone(p: Patient | undefined): string | undefined {
  return p?.telecom?.find((c) => c.system === "phone")?.value;
}

function patientEmail(p: Patient | undefined): string | undefined {
  return p?.telecom?.find((c) => c.system === "email")?.value;
}

function patientAddress(p: Patient | undefined): string | undefined {
  const a = p?.address?.[0];
  if (!a) return undefined;
  return a.text ?? [a.line?.join(" "), a.city, a.state, a.postalCode, a.country].filter(Boolean).join(", ");
}

export default function ProfilePage() {
  const t = useTranslations("profile");
  const locale = useLocale();
  const me = useUserMe();
  const patient = useMyPatient(me.data?.patientId);

  const loading = me.isLoading || patient.isLoading;
  const p = patient.data;
  const name = patientName(p, me.data?.name ?? "—");

  const rows: { label: string; value: string | undefined }[] = [
    { label: t("name"), value: name },
    { label: t("dateOfBirth"), value: p?.birthDate ? formatDate(p.birthDate, locale) : undefined },
    { label: t("gender"), value: p?.gender },
    { label: t("email"), value: patientEmail(p) ?? me.data?.email },
    { label: t("phone"), value: patientPhone(p) },
    { label: t("address"), value: patientAddress(p) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {loading ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : !me.data ? (
        <EmptyState title={t("empty")} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <dl className="divide-y divide-border">
              {rows.map((row) => (
                <div key={row.label} className="grid grid-cols-3 gap-3 px-6 py-4">
                  <dt className="text-sm font-medium text-muted-foreground">{row.label}</dt>
                  <dd className="col-span-2 text-sm">{row.value ?? "—"}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
