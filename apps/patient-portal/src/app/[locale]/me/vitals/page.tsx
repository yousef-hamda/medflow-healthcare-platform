"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { Observation } from "@medflow/fhir-types";
import { Card, CardContent, CardHeader, CardTitle, EmptyState, Skeleton } from "@medflow/ui";
import { PageHeader } from "@/components/PageHeader";
import { VitalsChart, type VitalsPoint, type VitalsSeries } from "@/components/VitalsChart";
import { useMyObservations } from "@/lib/api/hooks";
import { extractVitalSamples, withinWindow, type VitalMetric, type VitalSample } from "@/lib/vitals";
import { formatDate } from "@/lib/dates";

type WindowKey = "7" | "30" | "90" | "all";
const WINDOW_DAYS: Record<WindowKey, number | undefined> = { "7": 7, "30": 30, "90": 90, all: undefined };

const METRICS: { metric: VitalMetric; labelKey: string; unit: string }[] = [
  { metric: "heartRate", labelKey: "heartRate", unit: "bpm" },
  { metric: "bloodPressure", labelKey: "bloodPressure", unit: "mmHg" },
  { metric: "weight", labelKey: "weight", unit: "kg" },
  { metric: "spo2", labelKey: "spo2", unit: "%" },
];

export default function VitalsPage() {
  const t = useTranslations("vitals");
  const locale = useLocale();
  const observations = useMyObservations("vital-signs");
  const [windowKey, setWindowKey] = useState<WindowKey>("30");

  const obs: Observation[] = observations.data ?? [];

  const charts = useMemo(() => {
    return METRICS.map(({ metric, labelKey, unit }) => {
      const all = extractVitalSamples(obs, metric);
      const filtered = withinWindow(all, WINDOW_DAYS[windowKey]);
      return { metric, labelKey, unit, samples: filtered };
    });
  }, [obs, windowKey]);

  const hasAny = charts.some((c) => c.samples.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div role="group" aria-label={t("title")} className="inline-flex rounded-md border border-border p-1">
        {(Object.keys(WINDOW_DAYS) as WindowKey[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={windowKey === key}
            onClick={() => setWindowKey(key)}
            className={
              "rounded px-3 py-1.5 text-sm font-medium transition-colors " +
              (windowKey === key ? "bg-primary text-primary-foreground" : "text-foreground/70 hover:bg-accent")
            }
          >
            {t(key === "all" ? "windowAll" : `window${key}`)}
          </button>
        ))}
      </div>

      {observations.isLoading ? (
        <div className="grid gap-6 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full rounded-lg" />
          ))}
        </div>
      ) : !hasAny ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {charts
            .filter((c) => c.samples.length > 0)
            .map((c) => {
              const metricLabel = t(c.labelKey);
              const series: VitalsSeries[] =
                c.metric === "bloodPressure"
                  ? [
                      { key: "value", label: t("systolic"), color: "hsl(var(--primary))" },
                      { key: "value2", label: t("diastolic"), color: "hsl(var(--warning))" },
                    ]
                  : [{ key: "value", label: metricLabel, color: "hsl(var(--primary))" }];
              const data = toPoints(c.samples, locale);
              return (
                <Card key={c.metric}>
                  <CardHeader>
                    <CardTitle>{metricLabel}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <VitalsChart metricLabel={metricLabel} unit={c.unit} data={data} series={series} />
                  </CardContent>
                </Card>
              );
            })}
        </div>
      )}
    </div>
  );
}

function toPoints(samples: readonly VitalSample[], locale: string): VitalsPoint[] {
  return samples.map((s) => {
    const point: VitalsPoint = { date: formatDate(new Date(s.ts).toISOString(), locale), ts: s.ts };
    if (s.value !== undefined) point.value = s.value;
    if (s.value2 !== undefined) point.value2 = s.value2;
    return point;
  });
}
