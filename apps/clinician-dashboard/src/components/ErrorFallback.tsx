"use client";

import { Button, EmptyState } from "@medflow/ui";
import { useTranslations } from "next-intl";

interface ErrorFallbackProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  error?: Error;
}

/** Shared error UI used by route-level error boundaries and inline data views. */
export function ErrorFallback({
  title,
  description,
  onRetry,
  error,
}: ErrorFallbackProps): JSX.Element {
  const t = useTranslations();
  return (
    <div role="alert" className="p-6">
      <EmptyState
        title={title ?? t("errors.boundaryTitle")}
        description={description ?? error?.message ?? t("errors.boundaryDesc")}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4m0 4h.01" />
          </svg>
        }
        action={
          onRetry ? (
            <Button variant="outline" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}
