import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, unstable_setRequestLocale } from "next-intl/server";
import { ThemeProvider, ToastProvider, Toaster, themeInitScript } from "@medflow/ui";
import { Providers } from "@/components/Providers";
import { locales, localeDirection, isLocale } from "@/i18n/routing";
import "../globals.css";

const THEME_STORAGE_KEY = "mf-patient-theme";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params: { locale } }: { params: { locale: string } }): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "landing" });
  return {
    title: {
      default: "MedFlow — Patient Portal",
      template: "%s · MedFlow",
    },
    description: t("subtitle"),
  };
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  if (!isLocale(locale)) notFound();
  unstable_setRequestLocale(locale);

  const messages = await getMessages();
  const tA11y = await getTranslations({ locale, namespace: "a11y" });
  const dir = localeDirection(locale);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript(THEME_STORAGE_KEY) }} />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
            <ToastProvider>
              <Providers>
                <a href="#main" className="skip-link">
                  {tA11y("skip")}
                </a>
                {children}
                <Toaster />
              </Providers>
            </ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
