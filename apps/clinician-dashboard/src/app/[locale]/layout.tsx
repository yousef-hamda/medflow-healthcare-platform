import { ThemeProvider, ToastProvider, Toaster, themeInitScript } from "@medflow/ui";
import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, unstable_setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { Providers } from "@/components/Providers";
import { isLocale, localeDirection, locales } from "@/i18n/routing";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "MedFlow — Clinician Dashboard",
  description:
    "Risk-ranked worklist, patient 360, cohort builder and model governance. All data is synthetic.",
};

export function generateStaticParams(): Array<{ locale: string }> {
  return locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: LocaleLayoutProps): Promise<JSX.Element> {
  if (!isLocale(locale)) notFound();
  unstable_setRequestLocale(locale);

  const messages = await getMessages();
  const dir = localeDirection(locale);

  return (
    <html lang={locale} dir={dir} suppressHydrationWarning>
      <head>
        {/* Apply persisted theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="min-h-screen bg-background font-sans text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <ToastProvider>
              <Providers>
                <main id="main">{children}</main>
                <Toaster />
              </Providers>
            </ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
