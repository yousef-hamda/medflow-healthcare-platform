"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Skeleton,
  useToast,
} from "@medflow/ui";
import { PageHeader } from "@/components/PageHeader";
import { Field } from "@/components/Field";
import { useAppointments, useBookAppointment, useCancelAppointment } from "@/lib/api/hooks";
import type { Appointment } from "@/lib/api/types";
import { formatDateTime } from "@/lib/dates";

function statusVariant(status: Appointment["status"]): "default" | "secondary" | "success" | "destructive" {
  switch (status) {
    case "booked":
      return "success";
    case "completed":
      return "secondary";
    case "cancelled":
      return "destructive";
    default:
      return "default";
  }
}

export default function AppointmentsPage() {
  const t = useTranslations("appointments");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { toast } = useToast();

  const appointments = useAppointments();
  const book = useBookAppointment();
  const cancel = useCancelAppointment();

  const [bookOpen, setBookOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [provider, setProvider] = useState("");
  const [start, setStart] = useState("");

  const now = Date.now();
  const { upcoming, past } = useMemo(() => {
    const list = appointments.data ?? [];
    const up: Appointment[] = [];
    const pa: Appointment[] = [];
    for (const a of list) {
      const ts = new Date(a.start).getTime();
      if (a.status === "cancelled" || (Number.isFinite(ts) && ts < now)) pa.push(a);
      else up.push(a);
    }
    up.sort((a, b) => a.start.localeCompare(b.start));
    pa.sort((a, b) => b.start.localeCompare(a.start));
    return { upcoming: up, past: pa };
  }, [appointments.data, now]);

  function submitBooking(e: React.FormEvent) {
    e.preventDefault();
    book.mutate(
      { reason, provider, start: new Date(start).toISOString() },
      {
        onSuccess: () => {
          toast({ title: t("booked"), description: t("bookedBody"), variant: "success" });
          setBookOpen(false);
          setReason("");
          setProvider("");
          setStart("");
        },
        onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
      },
    );
  }

  function onCancel(id: string) {
    cancel.mutate(id, {
      onSuccess: () => toast({ title: t("cancelledToast"), variant: "success" }),
      onError: () => toast({ title: tCommon("error"), variant: "destructive" }),
    });
  }

  function AppointmentRow({ a, cancellable }: { a: Appointment; cancellable: boolean }) {
    return (
      <li className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div>
          <p className="font-medium">{a.reason}</p>
          <p className="text-sm text-muted-foreground">
            {t("with")} {a.provider} · {formatDateTime(a.start, locale)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={statusVariant(a.status)}>{a.status === "cancelled" ? t("cancelled") : a.status}</Badge>
          {cancellable ? (
            <Button size="sm" variant="outline" onClick={() => onCancel(a.id)} loading={cancel.isPending && cancel.variables === a.id}>
              {t("cancel")}
            </Button>
          ) : null}
        </div>
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        action={<Button onClick={() => setBookOpen(true)}>{t("book")}</Button>}
      />

      {appointments.isLoading ? (
        <Skeleton className="h-48 w-full rounded-lg" />
      ) : (
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>{t("upcoming")}</CardTitle>
            </CardHeader>
            <CardContent>
              {upcoming.length > 0 ? (
                <ul className="divide-y divide-border">
                  {upcoming.map((a) => (
                    <AppointmentRow key={a.id} a={a} cancellable />
                  ))}
                </ul>
              ) : (
                <EmptyState title={t("empty")} />
              )}
            </CardContent>
          </Card>

          {past.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t("past")}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {past.map((a) => (
                    <AppointmentRow key={a.id} a={a} cancellable={false} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}

      <Dialog open={bookOpen} onOpenChange={setBookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("bookTitle")}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitBooking} className="space-y-4">
            <Field label={t("reason")} required>
              {({ id }) => <Input id={id} required value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <Field label={t("provider")} required>
              {({ id }) => <Input id={id} required value={provider} onChange={(e) => setProvider(e.target.value)} />}
            </Field>
            <Field label={t("dateTime")} required>
              {({ id }) => <Input id={id} type="datetime-local" required value={start} onChange={(e) => setStart(e.target.value)} />}
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBookOpen(false)}>
                {tCommon("cancel")}
              </Button>
              <Button type="submit" loading={book.isPending}>
                {tCommon("book")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
