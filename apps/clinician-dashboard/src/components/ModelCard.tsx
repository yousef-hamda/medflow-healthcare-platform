"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@medflow/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ModelInfo } from "@/lib/api/types";
import { Sparkline } from "@/components/Sparkline";
import { renderMarkdown } from "@/lib/markdown";

interface ModelCardProps {
  model: ModelInfo;
}

function formatAuroc(value?: number): string {
  return typeof value === "number" ? value.toFixed(3) : "—";
}

export function ModelCard({ model }: ModelCardProps): JSX.Element {
  const t = useTranslations("models");
  const tc = useTranslations("common");
  const [cardOpen, setCardOpen] = useState(false);

  const history =
    model.production.aurocHistory && model.production.aurocHistory.length > 1
      ? model.production.aurocHistory
      : undefined;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle className="text-base">{model.name}</CardTitle>
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{model.id}</code>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t("production")}</span>
              <Badge>{model.production.version}</Badge>
            </div>
            <p className="mt-1 text-sm">
              {t("auroc")}: <span className="font-mono">{formatAuroc(model.production.auroc)}</span>
            </p>
          </div>
          <div className="rounded-md border border-dashed border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{t("canary")}</span>
              {model.canary ? (
                <Badge variant="secondary">{model.canary.version}</Badge>
              ) : (
                <span className="text-xs text-muted-foreground">{tc("none")}</span>
              )}
            </div>
            <p className="mt-1 text-sm">
              {t("auroc")}: <span className="font-mono">{formatAuroc(model.canary?.auroc)}</span>
            </p>
          </div>
        </div>

        {history ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("aurocTrend")}</p>
            <Sparkline
              values={history}
              summary={t("sparklineSummary", { model: model.name })}
            />
          </div>
        ) : null}

        {model.fairness && model.fairness.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("fairness")}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{t("subgroup")}</TableHead>
                  <TableHead scope="col">{t("metric")}</TableHead>
                  <TableHead scope="col" className="text-end">
                    {t("value")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {model.fairness.map((row, i) => (
                  <TableRow key={`${row.subgroup}-${row.metric}-${i}`}>
                    <TableCell>{row.subgroup}</TableCell>
                    <TableCell>{row.metric}</TableCell>
                    <TableCell className="text-end font-mono">{row.value.toFixed(3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {model.driftReportUrl ? (
            <a
              href={model.driftReportUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-primary underline underline-offset-2"
            >
              {t("driftLink")}
            </a>
          ) : null}
          {model.modelCard ? (
            <Button variant="outline" size="sm" onClick={() => setCardOpen(true)}>
              {t("modelCard")}
            </Button>
          ) : null}
        </div>
      </CardContent>

      {model.modelCard ? (
        <Dialog open={cardOpen} onOpenChange={setCardOpen}>
          <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t("modelCardTitle", { model: model.name })}</DialogTitle>
            </DialogHeader>
            <div className="text-foreground">{renderMarkdown(model.modelCard)}</div>
            <DialogFooter>
              <DialogClose>{tc("close")}</DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}
