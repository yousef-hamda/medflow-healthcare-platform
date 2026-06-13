"use client";

import { cn } from "@medflow/ui";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavItem {
  key: "worklist" | "cohort" | "audit" | "models";
  href: string;
  icon: ReactNode;
}

function iconFor(key: NavItem["key"]): ReactNode {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    "aria-hidden": true,
  } as const;
  switch (key) {
    case "worklist":
      return (
        <svg {...common}>
          <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
        </svg>
      );
    case "cohort":
      return (
        <svg {...common}>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-.01M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "audit":
      return (
        <svg {...common}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6M9 15l2 2 4-4" />
        </svg>
      );
    case "models":
      return (
        <svg {...common}>
          <path d="M12 2v4m0 12v4m10-10h-4M6 12H2m15.07-7.07-2.83 2.83M9.76 14.24l-2.83 2.83m0-10.14 2.83 2.83m4.48 4.48 2.83 2.83" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
  }
}

export function AppSidebar(): JSX.Element {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();

  const items: NavItem[] = [
    { key: "worklist", href: `/${locale}/worklist`, icon: iconFor("worklist") },
    { key: "cohort", href: `/${locale}/cohort`, icon: iconFor("cohort") },
    { key: "audit", href: `/${locale}/admin/audit`, icon: iconFor("audit") },
    { key: "models", href: `/${locale}/admin/models`, icon: iconFor("models") },
  ];

  return (
    <nav aria-label={t("worklist")} className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span>{t(item.key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
