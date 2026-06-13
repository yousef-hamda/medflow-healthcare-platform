"use client";

import { Button } from "@medflow/ui";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

import { useUserMe } from "@/lib/api/hooks";
import { useAuthStore } from "@/lib/auth/store";
import { clearAuthedCookie } from "@/lib/auth/session-cookie";
import { disconnectSocket } from "@/lib/realtime/socket";

export function UserMenu(): JSX.Element {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();
  const { data: user } = useUserMe();
  const session = useAuthStore((s) => s.session);
  const clearSession = useAuthStore((s) => s.clearSession);

  const displayName = user?.name ?? session?.user?.name ?? "Clinician";
  const role = user?.role ?? session?.user?.role;

  const logout = (): void => {
    clearSession();
    clearAuthedCookie();
    disconnectSocket();
    router.replace(`/${locale}/login`);
  };

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-end sm:block">
        <p className="text-sm font-medium leading-tight">{displayName}</p>
        {role ? <p className="text-xs text-muted-foreground">{role}</p> : null}
      </div>
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
      >
        {displayName.slice(0, 1).toUpperCase()}
      </span>
      <Button variant="outline" size="sm" onClick={logout}>
        {t("logout")}
      </Button>
    </div>
  );
}
