"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { cn } from "@medflow/ui";
import { useAuthStore } from "@/lib/auth/store";

interface NavItem {
  href: string;
  labelKey: string;
  icon: React.ReactNode;
}

const icons = {
  overview: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12 12 3l9 9M5 10v10h14V10" />
  ),
  results: <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-6m3 6V7m3 10v-3M4 4h16v16H4z" />,
  appointments: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M8 2v4m8-4v4M3 10h18M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
  ),
  vitals: <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h4l2 5 4-12 2 7h6" />,
  messages: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M21 11.5a8.38 8.38 0 0 1-9 8.5 9.53 9.53 0 0 1-4-1L3 21l1-4a9.5 9.5 0 1 1 17-5.5Z" />
  ),
  share: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M18 8a3 3 0 1 0-2.83-4M6 12a3 3 0 1 0 0 .01M18 16a3 3 0 1 0-2.83 4M8.6 13.5l6.8 3.9M15.4 6.6 8.6 10.5" />
  ),
  profile: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M20 21a8 8 0 1 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
  ),
};

const NAV: NavItem[] = [
  { href: "/me", labelKey: "overview", icon: icons.overview },
  { href: "/me/results", labelKey: "results", icon: icons.results },
  { href: "/me/appointments", labelKey: "appointments", icon: icons.appointments },
  { href: "/me/vitals", labelKey: "vitals", icon: icons.vitals },
  { href: "/me/messages", labelKey: "messages", icon: icons.messages },
  { href: "/me/share", labelKey: "share", icon: icons.share },
  { href: "/me/profile", labelKey: "profile", icon: icons.profile },
];

function NavLink({ item, locale, onNavigate }: { item: NavItem; locale: string; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const href = `/${locale}${item.href}`;
  const active = item.href === "/me" ? pathname === href : pathname?.startsWith(href);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
        {item.icon}
      </svg>
      <span>{t(item.labelKey)}</span>
    </Link>
  );
}

export function PortalSidebar() {
  const locale = useLocale();
  const t = useTranslations("a11y");
  return (
    <nav aria-label={t("mainNav")} className="hidden w-60 shrink-0 flex-col gap-1 border-e border-border bg-card/40 p-3 md:flex">
      {NAV.map((item) => (
        <NavLink key={item.href} item={item} locale={locale} />
      ))}
    </nav>
  );
}

export function PortalMobileNav() {
  const locale = useLocale();
  const t = useTranslations("a11y");
  const [open, setOpen] = useState(false);
  return (
    <div className="md:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mobile-nav"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border"
      >
        <span className="sr-only">{t("openMenu")}</span>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>
      {open ? (
        <nav id="mobile-nav" aria-label={t("mainNav")} className="absolute inset-x-0 top-full z-40 flex flex-col gap-1 border-b border-border bg-card p-3 shadow-lg">
          {NAV.map((item) => (
            <NavLink key={item.href} item={item} locale={locale} onNavigate={() => setOpen(false)} />
          ))}
        </nav>
      ) : null}
    </div>
  );
}

export function LogoutButton() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const clearSession = useAuthStore((s) => s.clearSession);
  function onLogout() {
    clearSession();
    document.cookie = "mf_authed=; path=/; max-age=0; SameSite=Lax";
    router.replace(`/${locale}/login`);
  }
  return (
    <button
      type="button"
      onClick={onLogout}
      className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />
      </svg>
      <span>{t("logout")}</span>
    </button>
  );
}
