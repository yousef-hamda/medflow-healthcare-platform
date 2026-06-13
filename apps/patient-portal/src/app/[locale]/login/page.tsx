"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@medflow/ui";
import { Field } from "@/components/Field";
import { SyntheticDataBanner } from "@/components/SyntheticDataBanner";
import { startMockSession } from "@/lib/auth/session";

function LoginForm() {
  const t = useTranslations("login");
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = schema.safeParse({ email, password });
    if (!result.success) {
      const fieldErrors: { email?: string; password?: string } = {};
      for (const issue of result.error.issues) {
        if (issue.path[0] === "email") fieldErrors.email = t("invalidEmail");
        if (issue.path[0] === "password") fieldErrors.password = t("passwordRequired");
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    // Mock auth: accept any valid email + password.
    const name = email.split("@")[0]?.replace(/\W+/g, " ").trim() || "Patient";
    startMockSession({ id: "patient-synthetic", name, email, patientId: "synthetic-patient-001" });
    const redirect = params.get("redirect");
    const dest = redirect && redirect.startsWith("/me") ? `/${locale}${redirect}` : `/${locale}/me`;
    router.replace(dest);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md shadow-xl">
      <CardHeader>
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={onSubmit} className="space-y-4">
          <Field label={t("email")} error={errors.email} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <Field label={t("password")} error={errors.password} required>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <p className="text-xs text-muted-foreground">{t("demoHint")}</p>
          <Button type="submit" className="w-full" loading={submitting}>
            {submitting ? t("signingIn") : t("submit")}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href={`/${locale}/register`} className="font-medium text-primary hover:underline">
            {t("registerLink")}
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <>
      <SyntheticDataBanner />
      <main id="main" className="portal-gradient grid min-h-dvh place-items-center p-4">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </>
  );
}
