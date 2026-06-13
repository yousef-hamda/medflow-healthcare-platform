"use client";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  useToast,
} from "@medflow/ui";
import { useLocale, useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useState, type FormEvent } from "react";

import { useAuthStore } from "@/lib/auth/store";
import { setAuthedCookie } from "@/lib/auth/session-cookie";
import { buildAuthorizeUrl, parseSmartLaunch } from "@/lib/auth/smart";

function LoginForm(): JSX.Element {
  const t = useTranslations("login");
  const tApp = useTranslations("app");
  const { toast } = useToast();
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const setSession = useAuthStore((s) => s.setSession);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [smartLaunching, setSmartLaunching] = useState(false);
  const userId = useId();
  const passId = useId();

  const from = searchParams.get("from");

  // SMART EHR launch: when iss+launch are present, kick off the PKCE redirect.
  useEffect(() => {
    const launch = parseSmartLaunch(searchParams);
    if (launch.iss && launch.launch) {
      setSmartLaunching(true);
      buildAuthorizeUrl(launch)
        .then((url) => {
          window.location.assign(url);
        })
        .catch(() => {
          setSmartLaunching(false);
          toast({ title: t("invalid"), variant: "destructive" });
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!username.trim() || !password.trim()) {
      toast({ title: t("invalid"), variant: "destructive" });
      return;
    }
    // Standalone mock login: synthesize a session token (in-memory only) and
    // set the presence cookie the middleware checks.
    setSession({
      accessToken: `mock.${btoa(`${username}:${Date.now()}`)}`,
      tokenType: "Bearer",
      expiresAt: Date.now() + 60 * 60 * 1000,
      user: { id: username, name: username, role: "clinician" },
    });
    setAuthedCookie();
    const dest = from && from.startsWith("/") ? `/${locale}${from}` : `/${locale}/worklist`;
    router.replace(dest);
  };

  if (smartLaunching) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{t("smartLaunch")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("smartRedirect")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
              M
            </span>
            <span className="text-lg font-semibold">{tApp("name")}</span>
          </div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor={userId} className="text-sm font-medium">
                {t("username")}
              </label>
              <Input
                id={userId}
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={passId} className="text-sm font-medium">
                {t("password")}
              </label>
              <Input
                id={passId}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <p className="rounded-md bg-accent/40 p-2 text-xs text-muted-foreground">
              {t("demoHint")}
            </p>
          </CardContent>
          <CardFooter className="flex-col items-stretch gap-3">
            <Button type="submit" className="w-full">
              {t("submit")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">{tApp("syntheticNotice")}</p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage(): JSX.Element {
  // useSearchParams requires a Suspense boundary under static rendering.
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <LoginForm />
    </Suspense>
  );
}
