"use client";

import { Button } from "@medflow/ui";
import { useEffect } from "react";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Global locale-scoped error boundary. Kept dependency-free of next-intl so it
 * renders even if the intl context failed to initialize.
 */
export default function LocaleError({ error, reset }: ErrorProps): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The dashboard hit an unexpected error. Try again, and if the problem persists, contact
        support.
      </p>
      <Button onClick={reset}>Retry</Button>
    </div>
  );
}
