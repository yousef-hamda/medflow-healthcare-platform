import { getTranslations, unstable_setRequestLocale } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppSidebar } from "@/components/AppSidebar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UserMenu } from "@/components/UserMenu";

interface AdminLayoutProps {
  children: ReactNode;
  params: { locale: string };
}

/** Admin shares the clinician shell; route protection is handled in middleware. */
export default async function AdminLayout({
  children,
  params: { locale },
}: AdminLayoutProps): Promise<JSX.Element> {
  unstable_setRequestLocale(locale);
  const tApp = await getTranslations("app");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <Link href={`/${locale}/worklist`} className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary font-bold text-primary-foreground">
            M
          </span>
          <span className="hidden font-semibold sm:inline">{tApp("name")}</span>
        </Link>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden w-60 shrink-0 border-e border-border md:block">
          <div className="sticky top-14">
            <AppSidebar />
          </div>
        </aside>
        <div className="min-w-0 flex-1">
          <div className="border-b border-border md:hidden">
            <AppSidebar />
          </div>
          <div className="mx-auto max-w-7xl p-4 sm:p-6">{children}</div>
        </div>
      </div>

      <footer className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
        {tApp("syntheticNotice")}
      </footer>
    </div>
  );
}
