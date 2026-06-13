"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@medflow/ui";
import { useTranslations } from "next-intl";

import type { AuditEventRecord } from "@/lib/api/types";

interface AuditDrawerProps {
  event: AuditEventRecord | null;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value?: string }): JSX.Element | null {
  if (!value) return null;
  return (
    <div className="grid grid-cols-3 gap-2 py-1">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2 break-words font-mono text-sm">{value}</dd>
    </div>
  );
}

export function AuditDrawer({ event, onClose }: AuditDrawerProps): JSX.Element {
  const t = useTranslations("audit");
  const tc = useTranslations("common");

  return (
    <Dialog open={event !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("detailTitle")}</DialogTitle>
        </DialogHeader>
        {event ? (
          <dl className="divide-y divide-border">
            <Row label={t("col.time")} value={new Date(event.ts).toLocaleString()} />
            <Row label={t("col.actor")} value={event.actorId} />
            <Row label={t("col.role")} value={event.actorRole} />
            <Row label={t("col.action")} value={event.action} />
            <Row
              label={t("col.resource")}
              value={`${event.resourceType}/${event.resourceId}`}
            />
            <Row label={t("ip")} value={event.ip} />
            <Row label={t("userAgent")} value={event.userAgent} />
            <Row label={t("col.justification")} value={event.justification} />
            <Row label="hash" value={event.hash} />
            <Row label="prevHash" value={event.prevHash} />
          </dl>
        ) : null}
        <DialogFooter>
          <DialogClose>{tc("close")}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
