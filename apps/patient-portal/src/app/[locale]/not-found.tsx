import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@medflow/ui";
import { defaultLocale } from "@/i18n/routing";

export default async function NotFound() {
  const t = await getTranslations({ locale: defaultLocale, namespace: "errors" });
  return (
    <main id="main" className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="space-y-4">
        <p className="text-5xl font-bold text-primary">404</p>
        <h1 className="text-2xl font-bold">{t("notFoundTitle")}</h1>
        <p className="text-muted-foreground">{t("notFoundBody")}</p>
        <Link href={`/${defaultLocale}/me`} className={buttonVariants()}>
          {t("goHome")}
        </Link>
      </div>
    </main>
  );
}
