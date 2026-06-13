"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAuthStore } from "@/lib/auth/store";
import { setAuthedCookie } from "@/lib/auth/session-cookie";
import { exchangeCodeForToken } from "@/lib/auth/smart";
import { defaultLocale } from "@/i18n/routing";

/**
 * SMART/OAuth redirect handler. Exchanges the authorization code for tokens,
 * stores the (in-memory) session and the presence cookie, then forwards into
 * the app. Runs entirely client-side.
 */
function CallbackInner(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const oauthError = searchParams.get("error");

    if (oauthError) {
      setError(oauthError);
      return;
    }
    if (!code) {
      setError("Missing authorization code");
      return;
    }

    exchangeCodeForToken(code, state)
      .then((session) => {
        setSession(session);
        setAuthedCookie();
        router.replace(`/${defaultLocale}/worklist`);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : "Authorization failed");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      {error ? (
        <>
          <h1 className="text-lg font-semibold text-destructive">Authorization failed</h1>
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <a
            href={`/${defaultLocale}/login`}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Back to sign in
          </a>
        </>
      ) : (
        <>
          <div
            className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
            aria-hidden="true"
          />
          <p className="text-sm text-muted-foreground">Completing sign-in…</p>
        </>
      )}
    </div>
  );
}

export default function CallbackPage(): JSX.Element {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <CallbackInner />
    </Suspense>
  );
}
