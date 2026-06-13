import { redirect } from "next/navigation";
import { unstable_setRequestLocale } from "next-intl/server";

interface PageProps {
  params: { locale: string };
}

export default function LocaleIndex({ params: { locale } }: PageProps) {
  unstable_setRequestLocale(locale);
  // The middleware gates auth; unauthenticated users are bounced to /login.
  redirect(`/${locale}/worklist`);
}
