"use client";

import { EmptyState, Skeleton } from "@medflow/ui";
import { useTranslations } from "next-intl";

import { ErrorFallback } from "@/components/ErrorFallback";
import { ModelCard } from "@/components/ModelCard";
import { useAdminModels } from "@/lib/api/hooks";

export default function ModelsPage(): JSX.Element {
  const t = useTranslations("models");
  const models = useAdminModels();

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {models.isError ? (
        <ErrorFallback onRetry={() => void models.refetch()} />
      ) : models.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-72 w-full" />
          ))}
        </div>
      ) : !models.data || models.data.length === 0 ? (
        <EmptyState title={t("noModels")} description={t("noModelsDesc")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {models.data.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}
    </section>
  );
}
