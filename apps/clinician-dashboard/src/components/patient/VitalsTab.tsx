"use client";

import { Button, EmptyState, Skeleton } from "@medflow/ui";
import type { VitalsReading } from "@medflow/shared-types";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { VitalsChart, type VitalsPoint } from "@/components/VitalsChart";
import { useObservations } from "@/lib/api/hooks";
import { observationTime, observationValue } from "@/lib/fhir-display";
import { useRealtimeAlerts } from "@/lib/realtime/useRealtimeAlerts";

type Window = "6h" | "24h" | "7d";

const WINDOW_MS: Record<Window, number> = {
  "6h": 6 * 3600_000,
  "24h": 24 * 3600_000,
  "7d": 7 * 24 * 3600_000,
};

// LOINC codes for common vitals so the FHIR query can be filtered server-side.
const VITAL_LOINC = {
  heartRate: "8867-4",
  spo2: "59408-5",
  respRate: "9279-1",
  temp: "8310-5",
  systolic: "8480-6",
  diastolic: "8462-4",
} as const;

interface LivePoint {
  ts: number;
  heartRate?: number;
  spo2?: number;
  respRate?: number;
  temp?: number;
  systolic?: number;
  diastolic?: number;
}

export function VitalsTab({ patientId }: { patientId: string }): JSX.Element {
  const t = useTranslations("patient.vitals");
  const [window, setWindow] = useState<Window>("24h");
  const [livePoints, setLivePoints] = useState<LivePoint[]>([]);

  const observations = useObservations(patientId, {
    code: Object.values(VITAL_LOINC).join(","),
    _count: 500,
  });

  // Append realtime vitals to the live buffer.
  useRealtimeAlerts({
    patientId,
    onVitals: (reading: VitalsReading) => {
      setLivePoints((prev) =>
        [
          ...prev,
          {
            ts: Date.parse(reading.ts) || Date.now(),
            heartRate: reading.heartRate,
            spo2: reading.spo2,
            respRate: reading.respiratoryRate,
            temp: reading.temperatureC,
            systolic: reading.systolicBp,
            diastolic: reading.diastolicBp,
          },
        ].slice(-500),
      );
    },
  });

  // Reset the live buffer when switching patient.
  useEffect(() => {
    setLivePoints([]);
  }, [patientId]);

  const points = useMemo<VitalsPoint[]>(() => {
    const cutoff = Date.now() - WINDOW_MS[window];
    const byTs = new Map<number, LivePoint>();

    for (const obs of observations.data ?? []) {
      const ts = observationTime(obs);
      const value = observationValue(obs);
      if (ts === undefined || value === undefined || ts < cutoff) continue;
      const code = obs.code.coding?.[0]?.code;
      const point = byTs.get(ts) ?? { ts };
      if (code === VITAL_LOINC.heartRate) point.heartRate = value;
      else if (code === VITAL_LOINC.spo2) point.spo2 = value;
      else if (code === VITAL_LOINC.respRate) point.respRate = value;
      else if (code === VITAL_LOINC.temp) point.temp = value;
      else if (code === VITAL_LOINC.systolic) point.systolic = value;
      else if (code === VITAL_LOINC.diastolic) point.diastolic = value;
      byTs.set(ts, point);
    }
    for (const lp of livePoints) {
      if (lp.ts < cutoff) continue;
      const point = byTs.get(lp.ts) ?? { ts: lp.ts };
      byTs.set(lp.ts, { ...point, ...lp });
    }

    return Array.from(byTs.values())
      .sort((a, b) => a.ts - b.ts)
      .map((p) => ({
        ts: p.ts,
        heartRate: p.heartRate ?? Number.NaN,
        spo2: p.spo2 ?? Number.NaN,
        respRate: p.respRate ?? Number.NaN,
        temp: p.temp ?? Number.NaN,
        systolic: p.systolic ?? Number.NaN,
        diastolic: p.diastolic ?? Number.NaN,
      }));
  }, [observations.data, livePoints, window]);

  const windows: Window[] = ["6h", "24h", "7d"];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("title")}</h2>
        <div
          role="group"
          aria-label={t("window")}
          className="inline-flex rounded-md border border-border p-1"
        >
          {windows.map((w) => (
            <Button
              key={w}
              size="sm"
              variant={window === w ? "default" : "ghost"}
              aria-pressed={window === w}
              onClick={() => setWindow(w)}
            >
              {t(w === "6h" ? "w6h" : w === "24h" ? "w24h" : "w7d")}
            </Button>
          ))}
        </div>
      </div>

      {observations.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 w-full" />
          ))}
        </div>
      ) : points.length === 0 ? (
        <EmptyState title={t("empty")} description={t("emptyDesc")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <VitalsChart
            title={t("heartRate")}
            data={points}
            unitSummary={t("summary", { metric: t("heartRate") })}
            series={[{ key: "heartRate", label: t("heartRate"), color: "hsl(var(--risk-high))" }]}
          />
          <VitalsChart
            title={t("spo2")}
            data={points}
            unitSummary={t("summary", { metric: t("spo2") })}
            series={[{ key: "spo2", label: t("spo2"), color: "hsl(var(--primary))" }]}
          />
          <VitalsChart
            title={t("respRate")}
            data={points}
            unitSummary={t("summary", { metric: t("respRate") })}
            series={[{ key: "respRate", label: t("respRate"), color: "hsl(var(--risk-medium))" }]}
          />
          <VitalsChart
            title={t("temp")}
            data={points}
            unitSummary={t("summary", { metric: t("temp") })}
            series={[{ key: "temp", label: t("temp"), color: "hsl(var(--warning))" }]}
          />
          <VitalsChart
            title={t("bp")}
            data={points}
            unitSummary={t("summary", { metric: t("bp") })}
            series={[
              { key: "systolic", label: t("systolic"), color: "hsl(var(--risk-high))" },
              { key: "diastolic", label: t("diastolic"), color: "hsl(var(--primary))" },
            ]}
          />
        </div>
      )}
    </div>
  );
}
