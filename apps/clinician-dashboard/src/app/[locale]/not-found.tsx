import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound(): Promise<JSX.Element> {
  let title = "Page not found";
  let description = "The page you requested does not exist.";
  let goHome = "Go to worklist";
  try {
    const t = await getTranslations("errors");
    title = t("notFoundTitle");
    description = t("notFoundDesc");
    goHome = t("goHome");
  } catch {
    // Fall back to English defaults when invoked outside a locale context.
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-5xl font-bold text-muted-foreground">404</p>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      <Link
        href="/en/worklist"
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
      >
        {goHome}
      </Link>
    </div>
  );
}
