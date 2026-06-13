"use client";

import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@medflow/ui";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { useBreakGlass } from "@/lib/api/hooks";

interface BreakGlassDialogProps {
  patientId: string;
  /** Called with the revealed full MRN on success. */
  onRevealed: (mrn: string) => void;
  triggerLabel: string;
}

/**
 * Break-glass reveal flow: requires a free-text clinical justification, posts it
 * to /abac/break-glass, and surfaces the revealed MRN. The access is recorded
 * server-side in the hash-chained audit log.
 */
export function BreakGlassDialog({
  patientId,
  onRevealed,
  triggerLabel,
}: BreakGlassDialogProps): JSX.Element {
  const t = useTranslations("patient");
  const tc = useTranslations("common");
  const { toast } = useToast();
  const breakGlass = useBreakGlass();
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState("");
  const fieldId = useId();

  const submit = (): void => {
    if (justification.trim().length < 5) return;
    breakGlass.mutate(
      { patientId, justification: justification.trim() },
      {
        onSuccess: (res) => {
          if (res.granted && res.mrn) {
            onRevealed(res.mrn);
            toast({ title: t("revealed"), variant: "success" });
            setOpen(false);
            setJustification("");
          } else {
            toast({ title: t("revealError"), variant: "destructive" });
          }
        },
        onError: () => {
          toast({ title: t("revealError"), variant: "destructive" });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {triggerLabel}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("revealTitle")}</DialogTitle>
          <DialogDescription>{t("revealDesc")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <label htmlFor={fieldId} className="text-sm font-medium">
            {t("justification")}
          </label>
          <textarea
            id={fieldId}
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={4}
            placeholder={t("justificationPlaceholder")}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <DialogFooter>
          <DialogClose>{tc("cancel")}</DialogClose>
          <Button
            onClick={submit}
            loading={breakGlass.isPending}
            disabled={justification.trim().length < 5}
          >
            {t("revealConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
