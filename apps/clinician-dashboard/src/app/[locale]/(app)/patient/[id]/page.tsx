"use client";

import {
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@medflow/ui";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

import { BreakGlassDialog } from "@/components/BreakGlassDialog";
import { ErrorFallback } from "@/components/ErrorFallback";
import { ImagingTab } from "@/components/patient/ImagingTab";
import { MessagesTab } from "@/components/patient/MessagesTab";
import { NotesTab } from "@/components/patient/NotesTab";
import { RiskTab } from "@/components/patient/RiskTab";
import { SummaryTab } from "@/components/patient/SummaryTab";
import { VitalsTab } from "@/components/patient/VitalsTab";
import { usePatient } from "@/lib/api/hooks";
import { patientMrn, patientName } from "@/lib/fhir-display";
import { maskMrn } from "@/lib/mrn";

interface PatientPageProps {
  params: { id: string; locale: string };
}

export default function PatientPage({ params }: PatientPageProps): JSX.Element {
  const { id } = params;
  const t = useTranslations("patient");
  const tNav = useTranslations("nav");
  const locale = useLocale();
  const patient = usePatient(id);
  const [revealedMrn, setRevealedMrn] = useState<string | null>(null);

  const name = patientName(patient.data);
  const mrn = patientMrn(patient.data);
  const displayMrn = revealedMrn ?? maskMrn(mrn);

  if (patient.isError) {
    return <ErrorFallback onRetry={() => void patient.refetch()} />;
  }

  const tabKeys = ["summary", "vitals", "risk", "imaging", "notes", "messages"] as const;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <nav aria-label="Breadcrumb" className="mb-1 text-sm text-muted-foreground">
            <Link href={`/${locale}/worklist`} className="hover:underline">
              {tNav("worklist")}
            </Link>
          </nav>
          {patient.isLoading ? (
            <Skeleton className="h-8 w-56" />
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
          )}
          <div className="mt-1 flex items-center gap-3">
            <span className="font-mono text-sm text-muted-foreground" data-testid="mrn">
              {displayMrn}
            </span>
            {!revealedMrn && mrn ? (
              <BreakGlassDialog
                patientId={id}
                triggerLabel={t("reveal")}
                onRevealed={(full) => setRevealedMrn(full)}
              />
            ) : null}
          </div>
        </div>
      </div>

      <Tabs defaultValue="summary">
        <TabsList className="flex flex-wrap">
          {tabKeys.map((key) => (
            <TabsTrigger key={key} value={key}>
              {t(`tabs.${key}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="summary">
          <SummaryTab patientId={id} patient={patient.data} />
        </TabsContent>
        <TabsContent value="vitals">
          <VitalsTab patientId={id} />
        </TabsContent>
        <TabsContent value="risk">
          <RiskTab patientId={id} />
        </TabsContent>
        <TabsContent value="imaging">
          <ImagingTab patientId={id} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab patientId={id} />
        </TabsContent>
        <TabsContent value="messages">
          <MessagesTab patientId={id} />
        </TabsContent>
      </Tabs>
    </section>
  );
}
