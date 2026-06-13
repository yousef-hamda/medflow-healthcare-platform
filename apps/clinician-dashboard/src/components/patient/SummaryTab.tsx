"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
} from "@medflow/ui";
import type { Patient } from "@medflow/fhir-types";
import { useTranslations } from "next-intl";

import { useConditions, useMedications } from "@/lib/api/hooks";
import {
  ageFromBirthDate,
  conditionLabel,
  medicationLabel,
} from "@/lib/fhir-display";

interface SummaryTabProps {
  patientId: string;
  patient?: Patient;
}

export function SummaryTab({ patientId, patient }: SummaryTabProps): JSX.Element {
  const t = useTranslations("patient.summary");
  const conditions = useConditions(patientId);
  const medications = useMedications(patientId);

  const age = ageFromBirthDate(patient?.birthDate);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("demographics")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("gender")}</dt>
            <dd className="capitalize">{patient?.gender ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("birthDate")}</dt>
            <dd>{patient?.birthDate ?? "—"}</dd>
            <dt className="text-muted-foreground">{t("age")}</dt>
            <dd>{age ?? "—"}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("conditions")}</CardTitle>
        </CardHeader>
        <CardContent>
          {conditions.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : conditions.data && conditions.data.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {conditions.data.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {conditionLabel(c)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("noConditions")}</p>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">{t("medications")}</CardTitle>
        </CardHeader>
        <CardContent>
          {medications.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : medications.data && medications.data.length > 0 ? (
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {medications.data.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />
                  {medicationLabel(m)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("noMedications")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
