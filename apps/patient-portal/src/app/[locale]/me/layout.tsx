import type { ReactNode } from "react";
import { unstable_setRequestLocale } from "next-intl/server";
import { SyntheticDataBanner } from "@/components/SyntheticDataBanner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { PortalSidebar, PortalMobileNav, LogoutButton } from "@/components/PortalNav";

export default function PortalLayout({
  children,
  params: { locale },
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  unstable_setRequestLocale(locale);
  return (
    <div className="flex min-h-dvh flex-col">
      <SyntheticDataBanner />
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <PortalMobileNav />
            <div className="flex items-center gap-2 text-lg font-semibold">
              <span aria-hidden="true" className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                M
              </span>
              <span>MedFlow</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <PortalSidebar />
        <main id="main" className="flex-1 px-4 py-6 md:px-8">
          <div className="mx-auto w-full max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
