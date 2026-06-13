"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@medflow/ui";

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  const tCommon = useTranslations("common");
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("body")}</p>
        <Button onClick={reset}>{tCommon("retry")}</Button>
      </div>
    </main>
  );
}
