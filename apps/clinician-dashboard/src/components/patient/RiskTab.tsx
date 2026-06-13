"use client";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  RiskBadge,
  Skeleton,
} from "@medflow/ui";
import { useTranslations } from "next-intl";
import { useEffect, useMemo } from "react";

import { CdsCardList } from "@/components/CdsCardList";
import { ShapBarChart } from "@/components/ShapBarChart";
import {
  useCdsCards,
  useCdsServices,
  useReadmissionPrediction,
  useSepsisPrediction,
} from "@/lib/api/hooks";
import type { FeatureContribution, PredictionResult } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/store";

interface RiskTabProps {
  patientId: string;
  encounterId?: string;
}

interface ScoreCardProps {
  title: string;
  result?: PredictionResult;
  loading: boolean;
  onRecompute: () => void;
  recomputeLabel: string;
  versionLabel: (version: string) => string;
}

function ScoreCard({
  title,
  result,
  loading,
  onRecompute,
  recomputeLabel,
  versionLabel,
}: ScoreCardProps): JSX.Element {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button size="sm" variant="outline" onClick={onRecompute} loading={loading}>
          {recomputeLabel}
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !result ? (
          <Skeleton className="h-10 w-32" />
        ) : result ? (
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-3xl font-bold tabular-nums">
                {Math.round(result.score * 100)}%
              </span>
              <RiskBadge score={result.score} level={result.band} />
            </div>
            <p className="text-xs text-muted-foreground">{versionLabel(result.modelVersion)}</p>
          </div>
        ) : (
          <span className="text-3xl font-bold text-muted-foreground">—</span>
        )}
      </CardContent>
    </Card>
  );
}

export function RiskTab({ patientId, encounterId }: RiskTabProps): JSX.Element {
  const t = useTranslations("patient.risk");
  const user = useAuthStore((s) => s.session?.user);

  const sepsis = useSepsisPrediction();
  const readmission = useReadmissionPrediction();
  const cdsServices = useCdsServices();

  // Compute predictions on mount (and expose a manual recompute).
  useEffect(() => {
    sepsis.mutate({ patientId, encounterId });
    readmission.mutate({ patientId, encounterId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  // Pick a patient-view CDS service to invoke (first discovered).
  const serviceId = useMemo(() => {
    const services = cdsServices.data?.services ?? [];
    return services.find((s) => s.hook === "patient-view")?.id ?? services[0]?.id ?? "";
  }, [cdsServices.data]);

  const cds = useCdsCards({
    serviceId,
    patientId,
    userId: user?.id ?? "clinician",
    encounterId,
    enabled: Boolean(serviceId),
  });

  const contributors: FeatureContribution[] =
    sepsis.data?.topContributors ?? readmission.data?.topContributors ?? [];

  const shapModel = sepsis.data ? t("sepsisCard") : t("readmissionCard");

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <ScoreCard
          title={t("sepsisCard")}
          result={sepsis.data}
          loading={sepsis.isPending}
          onRecompute={() => sepsis.mutate({ patientId, encounterId })}
          recomputeLabel={t("recompute")}
          versionLabel={(v) => t("modelVersion", { version: v })}
        />
        <ScoreCard
          title={t("readmissionCard")}
          result={readmission.data}
          loading={readmission.isPending}
          onRecompute={() => readmission.mutate({ patientId, encounterId })}
          recomputeLabel={t("recompute")}
          versionLabel={(v) => t("modelVersion", { version: v })}
        />
      </div>

      {contributors.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("shapTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ShapBarChart
              contributors={contributors}
              summary={t("shapSummary", { model: shapModel })}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("cdsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {cds.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <CdsCardList
              cards={cds.data ?? []}
              emptyTitle={t("noCds")}
              emptyDescription={t("noCdsDesc")}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
