"use client";

import {
  Button,
  Card,
  CardContent,
  EmptyState,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@medflow/ui";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { AuditDrawer } from "@/components/AuditDrawer";
import { ErrorFallback } from "@/components/ErrorFallback";
import { useAudit, type AuditQueryParams } from "@/lib/api/hooks";
import type { AuditEventRecord } from "@/lib/api/types";

const PAGE_SIZE = 20;

export default function AuditPage(): JSX.Element {
  const t = useTranslations("audit");
  const tc = useTranslations("common");

  const [draft, setDraft] = useState<Omit<AuditQueryParams, "page" | "pageSize">>({});
  const [applied, setApplied] = useState<Omit<AuditQueryParams, "page" | "pageSize">>({});
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AuditEventRecord | null>(null);

  const audit = useAudit({ page, pageSize: PAGE_SIZE, ...applied });

  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.total / PAGE_SIZE)) : 1;

  const apply = (): void => {
    setApplied(draft);
    setPage(0);
  };
  const clear = (): void => {
    setDraft({});
    setApplied({});
    setPage(0);
  };

  const chainBanner = (): JSX.Element => {
    if (audit.data?.chainValid === true) {
      return (
        <div role="status" className="rounded-md border border-success/40 bg-success/10 px-4 py-2 text-sm text-success">
          {t("chainValid")}
        </div>
      );
    }
    if (audit.data?.chainValid === false) {
      return (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {t("chainInvalid")}
        </div>
      );
    }
    return (
      <div className="rounded-md border border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
        {t("chainUnknown")}
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {chainBanner()}

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-3 lg:grid-cols-6">
          <label className="text-xs font-medium">
            {t("actor")}
            <Input
              value={draft.actor ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, actor: e.target.value }))}
            />
          </label>
          <label className="text-xs font-medium">
            {t("action")}
            <Input
              value={draft.action ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
            />
          </label>
          <label className="text-xs font-medium">
            {t("resourceType")}
            <Input
              value={draft.resourceType ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, resourceType: e.target.value }))}
            />
          </label>
          <label className="text-xs font-medium">
            {t("from")}
            <Input
              type="date"
              value={draft.from ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className="text-xs font-medium">
            {t("to")}
            <Input
              type="date"
              value={draft.to ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
          <div className="flex items-end gap-2">
            <Button size="sm" onClick={apply}>
              {t("apply")}
            </Button>
            <Button size="sm" variant="outline" onClick={clear}>
              {t("clear")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {audit.isError ? (
        <ErrorFallback onRetry={() => void audit.refetch()} />
      ) : audit.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !audit.data || audit.data.events.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <>
          <Table>
            <TableCaption>{t("caption")}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t("col.time")}</TableHead>
                <TableHead scope="col">{t("col.actor")}</TableHead>
                <TableHead scope="col">{t("col.role")}</TableHead>
                <TableHead scope="col">{t("col.action")}</TableHead>
                <TableHead scope="col">{t("col.resource")}</TableHead>
                <TableHead scope="col">{t("col.justification")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.data.events.map((event, i) => (
                <TableRow
                  key={event.id ?? `${event.ts}-${i}`}
                  className="cursor-pointer"
                  onClick={() => setSelected(event)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(event);
                    }
                  }}
                >
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(event.ts).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{event.actorId}</TableCell>
                  <TableCell>{event.actorRole}</TableCell>
                  <TableCell className="font-mono text-sm">{event.action}</TableCell>
                  <TableCell className="font-mono text-sm">
                    {event.resourceType}/{event.resourceId}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">
                    {event.justification ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {tc("page")} {page + 1} {tc("of")} {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                {tc("previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {tc("next")}
              </Button>
            </div>
          </div>
        </>
      )}

      <AuditDrawer event={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
