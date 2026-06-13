"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@medflow/ui";
import { PageHeader } from "@/components/PageHeader";
import { FlagBadge } from "@/components/FlagBadge";
import { ResultDetailDialog } from "@/components/ResultDetailDialog";
import { useMyObservations } from "@/lib/api/hooks";
import { groupResultsByPanel, formatRange, type LabResult } from "@/lib/labs";

export default function ResultsPage() {
  const t = useTranslations("results");
  // "laboratory" category per FHIR observation-category code system.
  const observations = useMyObservations("laboratory");
  const [selected, setSelected] = useState<LabResult | null>(null);

  const panels = useMemo(() => groupResultsByPanel(observations.data ?? []), [observations.data]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      {observations.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-lg" />
          ))}
        </div>
      ) : panels.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <div className="space-y-6">
          {panels.map((panel) => (
            <Card key={panel.panel}>
              <CardHeader>
                <CardTitle>{panel.panel}</CardTitle>
              </CardHeader>
              <CardContent className="px-0 sm:px-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("value")}</TableHead>
                      <TableHead className="hidden sm:table-cell">{t("reference")}</TableHead>
                      <TableHead>{t("flag")}</TableHead>
                      <TableHead className="text-end">{/* action */}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {panel.results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setSelected(r)}
                            className="text-start font-medium text-primary hover:underline focus-visible:underline"
                          >
                            {r.label}
                          </button>
                          <div className="text-sm tabular-nums text-muted-foreground">
                            {r.value !== undefined ? `${r.value}${r.unit ? ` ${r.unit}` : ""}` : r.valueText ?? "—"}
                          </div>
                        </TableCell>
                        <TableCell className="hidden tabular-nums text-muted-foreground sm:table-cell">
                          {formatRange(r.range) ?? t("noRange")}
                        </TableCell>
                        <TableCell>
                          <FlagBadge flag={r.flag} />
                        </TableCell>
                        <TableCell className="text-end">
                          <button
                            type="button"
                            onClick={() => setSelected(r)}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {t("openDetail")}
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ResultDetailDialog result={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
