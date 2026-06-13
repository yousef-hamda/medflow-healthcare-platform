"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { z } from "zod";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@medflow/ui";
import { Field } from "@/components/Field";
import { startMockSession } from "@/lib/auth/session";

type StepKey = "personal" | "contact" | "verify" | "done";
const STEP_ORDER: StepKey[] = ["personal", "contact", "verify", "done"];

interface FormState {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  otp: string;
}

const EMPTY: FormState = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  otp: "",
};

/** Generates a 6-digit mock OTP (no SMS is actually sent). */
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function RegisterWizard() {
  const t = useTranslations("register");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();

  const [stepIndex, setStepIndex] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [otpCode, setOtpCode] = useState<string>(() => generateOtp());

  const step = STEP_ORDER[stepIndex];
  const totalInputSteps = 3; // personal, contact, verify

  const personalSchema = useMemo(
    () =>
      z.object({
        firstName: z.string().trim().min(1, t("errors.firstName")),
        lastName: z.string().trim().min(1, t("errors.lastName")),
        dateOfBirth: z
          .string()
          .min(1, t("errors.dob"))
          .refine((v) => {
            const d = new Date(v);
            return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
          }, t("errors.dob")),
      }),
    [t],
  );

  const contactSchema = useMemo(
    () =>
      z
        .object({
          email: z.string().email(t("errors.email")),
          phone: z
            .string()
            .trim()
            .regex(/^\+?[0-9\s-]{7,}$/, t("errors.phone")),
          password: z.string().min(8, t("errors.password")),
          confirmPassword: z.string(),
        })
        .refine((v) => v.password === v.confirmPassword, {
          path: ["confirmPassword"],
          message: t("errors.passwordMatch"),
        }),
    [t],
  );

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function validateAndNext() {
    if (step === "personal") {
      const result = personalSchema.safeParse(form);
      if (!result.success) {
        setErrors(collectErrors(result.error));
        return;
      }
    } else if (step === "contact") {
      const result = contactSchema.safeParse(form);
      if (!result.success) {
        setErrors(collectErrors(result.error));
        return;
      }
      // Regenerate OTP when entering the verify step.
      setOtpCode(generateOtp());
    } else if (step === "verify") {
      if (!/^\d{6}$/.test(form.otp.trim())) {
        setErrors({ otp: t("errors.otp") });
        return;
      }
      if (form.otp.trim() !== otpCode) {
        setErrors({ otp: t("errors.otpWrong") });
        return;
      }
    }
    setErrors({});
    setStepIndex((i) => Math.min(i + 1, STEP_ORDER.length - 1));
  }

  function back() {
    setErrors({});
    setStepIndex((i) => Math.max(i - 1, 0));
  }

  function finish() {
    startMockSession({
      id: "patient-synthetic",
      name: `${form.firstName} ${form.lastName}`.trim(),
      email: form.email,
      patientId: "synthetic-patient-001",
    });
    router.replace(`/${locale}/login`);
  }

  const stepTitleKey: Record<StepKey, string> = {
    personal: "stepPersonal",
    contact: "stepContact",
    verify: "stepVerify",
    done: "stepDone",
  };

  return (
    <Card className="w-full max-w-lg shadow-xl">
      <CardHeader>
        <CardTitle className="text-2xl">{t("title")}</CardTitle>
        {step !== "done" ? (
          <CardDescription>
            {t("step", { current: stepIndex + 1, total: totalInputSteps })} — {t(stepTitleKey[step])}
          </CardDescription>
        ) : null}
        <ol className="mt-3 flex items-center gap-2" aria-label={t(stepTitleKey[step])}>
          {STEP_ORDER.slice(0, totalInputSteps).map((s, i) => (
            <li key={s} className="flex-1">
              <div
                aria-current={i === stepIndex ? "step" : undefined}
                className={
                  "h-1.5 rounded-full transition-colors " +
                  (i <= stepIndex ? "bg-primary" : "bg-muted")
                }
              />
            </li>
          ))}
        </ol>
      </CardHeader>
      <CardContent>
        {step === "personal" ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("firstName")} error={errors.firstName} required>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} autoComplete="given-name" value={form.firstName} onChange={(e) => setField("firstName", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
                )}
              </Field>
              <Field label={t("lastName")} error={errors.lastName} required>
                {({ id, describedBy, invalid }) => (
                  <Input id={id} autoComplete="family-name" value={form.lastName} onChange={(e) => setField("lastName", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
                )}
              </Field>
            </div>
            <Field label={t("dateOfBirth")} error={errors.dateOfBirth} required>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="date" autoComplete="bday" value={form.dateOfBirth} onChange={(e) => setField("dateOfBirth", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
              )}
            </Field>
          </div>
        ) : null}

        {step === "contact" ? (
          <div className="space-y-4">
            <Field label={t("email")} error={errors.email} required>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="email" autoComplete="email" value={form.email} onChange={(e) => setField("email", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
              )}
            </Field>
            <Field label={t("phone")} error={errors.phone} required>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setField("phone", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
              )}
            </Field>
            <Field label={t("password")} error={errors.password} required>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setField("password", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
              )}
            </Field>
            <Field label={t("confirmPassword")} error={errors.confirmPassword} required>
              {({ id, describedBy, invalid }) => (
                <Input id={id} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setField("confirmPassword", e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
              )}
            </Field>
          </div>
        ) : null}

        {step === "verify" ? (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">{t("otpTitle")}</h2>
              <p className="text-sm text-muted-foreground">{t("otpBody")}</p>
            </div>
            <div className="rounded-md border border-dashed border-warning/50 bg-warning/10 p-3 text-sm" role="note">
              {t("otpDevHint", { code: otpCode })}
            </div>
            <Field label={t("otpLabel")} error={errors.otp} required>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={form.otp}
                  onChange={(e) => setField("otp", e.target.value.replace(/\D/g, ""))}
                  aria-describedby={describedBy}
                  aria-invalid={invalid}
                />
              )}
            </Field>
            <button type="button" onClick={() => setOtpCode(generateOtp())} className="text-sm font-medium text-primary hover:underline">
              {t("resend")}
            </button>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-success/15 text-success" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold">{t("successTitle")}</h2>
            <p className="text-muted-foreground">{t("successBody")}</p>
            <Button className="w-full" onClick={finish}>
              {t("goToLogin")}
            </Button>
            <p className="text-sm text-muted-foreground">
              <Link href={`/${locale}/login`} className="font-medium text-primary hover:underline">
                {t("goToLogin")}
              </Link>
            </p>
          </div>
        ) : null}

        {step !== "done" ? (
          <div className="mt-6 flex items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={back} disabled={stepIndex === 0}>
              {tCommon("back")}
            </Button>
            <Button type="button" onClick={validateAndNext}>
              {step === "verify" ? tCommon("confirm") : tCommon("next")}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function collectErrors(error: z.ZodError): Partial<Record<keyof FormState, string>> {
  const out: Partial<Record<keyof FormState, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as keyof FormState | undefined;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
