"use client";

import {
  Button,
  EmptyState,
  RiskBadge,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@medflow/ui";
import type { KafkaAlertEvent } from "@medflow/shared-types";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useMemo } from "react";

import { ErrorFallback } from "@/components/ErrorFallback";
import { useWorklist } from "@/lib/api/hooks";
import type { WorklistItem } from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/store";
import { maskMrn } from "@/lib/mrn";
import { useRealtimeAlerts } from "@/lib/realtime/useRealtimeAlerts";
import { sortWorklist, type WorklistSortKey } from "@/lib/risk";
import { useWorklistStore } from "@/lib/stores/worklistStore";

function ariaSort(active: boolean, dir: "asc" | "desc"): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return dir === "asc" ? "ascending" : "descending";
}

function fmtScore(score?: number): string {
  return typeof score === "number" ? `${Math.round(score * 100)}%` : "—";
}

export default function WorklistPage(): JSX.Element {
  const t = useTranslations("worklist");
  const tc = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();
  const session = useAuthStore((s) => s.session);

  const { data, isLoading, isError, refetch } = useWorklist();
  const { sortKey, sortDirection, promotions, setSort, promote } = useWorklistStore();

  // Live sepsis alerts promote the patient to the top and toast with an ack.
  const onSepsisAlert = useCallback(
    (event: KafkaAlertEvent) => {
      promote(event.patientId);
      const name = data?.find((p) => p.patientId === event.patientId)?.name ?? event.patientId;
      // Sticky destructive toast (duration 0) — the toast's dismiss button acts
      // as the "Acknowledge" affordance, clearing the alert from the stack.
      toast({
        title: t("newAlert"),
        description: t("promoted", { name }),
        variant: "destructive",
        duration: 0,
      });
    },
    [data, promote, t, toast],
  );

  useRealtimeAlerts({ onSepsisAlert, enabled: Boolean(session) });

  const rows = useMemo(() => {
    if (!data) return [];
    const sorted = sortWorklist(data, sortKey, sortDirection);
    if (promotions.length === 0) return sorted;
    // Stable-promote alerted patients to the top, preserving promotion order.
    const promotedSet = new Set(promotions);
    const promoted = promotions
      .map((id) => sorted.find((p) => p.patientId === id))
      .filter((p): p is WorklistItem => Boolean(p));
    const rest = sorted.filter((p) => !promotedSet.has(p.patientId));
    return [...promoted, ...rest];
  }, [data, promotions, sortDirection, sortKey]);

  const columns: Array<{ key: WorklistSortKey; label: string; numeric?: boolean }> = [
    { key: "name", label: t("col.patient") },
    { key: "primary", label: t("col.primary"), numeric: true },
    { key: "sepsis", label: t("col.sepsis"), numeric: true },
    { key: "readmission", label: t("col.readmission"), numeric: true },
    { key: "updated", label: t("col.updated") },
  ];

  if (isError) {
    return <ErrorFallback onRetry={() => void refetch()} />;
  }

  return (
    <section aria-labelledby="worklist-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 id="worklist-heading" className="text-2xl font-semibold tracking-tight">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {tc("retry")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={t("empty")} description={t("emptyDesc")} />
      ) : (
        <Table>
          <TableCaption>{t("caption")}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <TableHead
                    key={col.key}
                    scope="col"
                    aria-sort={ariaSort(active, sortDirection)}
                    className={col.numeric ? "text-end" : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => setSort(col.key)}
                      className="inline-flex items-center gap-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                    >
                      {col.label}
                      <span aria-hidden="true" className="text-xs">
                        {active ? (sortDirection === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((item) => {
              const promoted = promotions.includes(item.patientId);
              return (
                <TableRow key={item.patientId} className={promoted ? "bg-destructive/5" : undefined}>
                  <TableCell>
                    <Link
                      href={`/${locale}/patient/${item.patientId}`}
                      className="font-medium underline-offset-2 hover:underline"
                      aria-label={t("open", { name: item.name })}
                    >
                      {item.name}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">
                      {maskMrn(item.mrn)}
                    </div>
                  </TableCell>
                  <TableCell className="text-end">
                    <RiskBadge score={item.primaryScore} level={item.primaryBand} />
                  </TableCell>
                  <TableCell className="text-end font-mono tabular-nums">
                    {fmtScore(item.sepsisScore)}
                  </TableCell>
                  <TableCell className="text-end font-mono tabular-nums">
                    {fmtScore(item.readmissionScore)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {new Date(item.updatedAt).toLocaleString(locale)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
