import Link from "next/link";
import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { buttonVariants, Card, CardContent, CardHeader, CardTitle } from "@medflow/ui";
import { SyntheticDataBanner } from "@/components/SyntheticDataBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function LandingPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "landing" });

  const features = [
    { title: t("feature1Title"), body: t("feature1Body") },
    { title: t("feature2Title"), body: t("feature2Body") },
    { title: t("feature3Title"), body: t("feature3Body") },
  ];

  return (
    <>
      <SyntheticDataBanner />
      <main id="main" className="portal-gradient min-h-dvh">
        <header className="container flex items-center justify-between py-5">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">M</span>
            <span>MedFlow</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </header>

        <section className="container grid items-center gap-10 py-12 md:grid-cols-2 md:py-20">
          <div className="animate-slide-in-up">
            <p className="mb-3 text-sm font-medium uppercase tracking-wide text-primary">{t("eyebrow")}</p>
            <h1 className="text-balance text-4xl font-bold leading-tight tracking-tight md:text-5xl">{t("title")}</h1>
            <p className="mt-4 max-w-prose text-lg text-muted-foreground">{t("subtitle")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/${locale}/login`} className={buttonVariants({ size: "lg" })}>
                {t("ctaPrimary")}
              </Link>
              <Link href={`/${locale}/register`} className={buttonVariants({ size: "lg", variant: "outline" })}>
                {t("ctaSecondary")}
              </Link>
            </div>
          </div>

          <div aria-hidden="true" className="relative hidden md:block">
            <div className="absolute -inset-6 rounded-3xl bg-primary/10 blur-2xl" />
            <div className="relative grid gap-4 rounded-3xl border border-border bg-card/70 p-6 shadow-xl backdrop-blur">
              <div className="flex items-center justify-between rounded-xl bg-success/15 p-4">
                <span className="font-medium">HbA1c</span>
                <span className="font-semibold text-success">5.4%</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-accent p-4">
                <span className="font-medium">Heart rate</span>
                <span className="font-semibold">68 bpm</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-warning/15 p-4">
                <span className="font-medium">LDL cholesterol</span>
                <span className="font-semibold text-warning">142 mg/dL</span>
              </div>
            </div>
          </div>
        </section>

        <section className="container grid gap-6 pb-24 md:grid-cols-3">
          {features.map((f) => (
            <Card key={f.title} className="animate-fade-in">
              <CardHeader>
                <CardTitle className="text-xl">{f.title}</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground">{f.body}</CardContent>
            </Card>
          ))}
        </section>
      </main>
    </>
  );
}
