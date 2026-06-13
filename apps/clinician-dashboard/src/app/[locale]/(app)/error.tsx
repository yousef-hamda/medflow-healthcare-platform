"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/ErrorFallback";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AppError({ error, reset }: ErrorProps): JSX.Element {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return <ErrorFallback error={error} onRetry={reset} />;
}
