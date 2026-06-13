"use client";

import { useLocale, useTranslations } from "next-intl";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@medflow/ui";
import { FlagBadge } from "@/components/FlagBadge";
import { explainLoinc } from "@/lib/loinc-explanations";
import { formatDate } from "@/lib/dates";
import { formatRange, type LabResult } from "@/lib/labs";

export function ResultDetailDialog({ result, onClose }: { result: LabResult | null; onClose: () => void }) {
  const t = useTranslations("results");
  const locale = useLocale();
  const explanation = result ? explainLoinc(result.loinc) : undefined;
  const interpretationKey =
    result?.flag === "high" ? "interpretationHigh" : result?.flag === "low" ? "interpretationLow" : "interpretationNormal";

  const valueDisplay =
    result?.value !== undefined ? `${result.value}${result.unit ? ` ${result.unit}` : ""}` : result?.valueText ?? "—";
  const rangeDisplay = result ? formatRange(result.range) : undefined;

  return (
    <Dialog open={result !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
      {result ? (
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{explanation?.short ?? result.label}</DialogTitle>
            {result.effective ? <DialogDescription>{formatDate(result.effective, locale)}</DialogDescription> : null}
          </DialogHeader>

          <div className="space-y-5">
            {explanation ? (
              <section>
                <h3 className="text-sm font-semibold text-muted-foreground">{t("detailWhat")}</h3>
                <p className="mt-1 text-sm">{explanation.plain}</p>
              </section>
            ) : null}

            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("detailYourValue")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{valueDisplay}</p>
                <div className="mt-2">
                  <FlagBadge flag={result.flag} />
                </div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("detailRange")}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">{rangeDisplay ?? t("noRange")}</p>
              </div>
            </div>

            <section>
              <h3 className="text-sm font-semibold text-muted-foreground">{t("detailInterpretation")}</h3>
              <p className="mt-1 text-sm">{t(interpretationKey)}</p>
            </section>

            <p className="text-xs text-muted-foreground">{t("disclaimer")}</p>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
