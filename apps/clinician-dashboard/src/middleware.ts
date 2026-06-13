import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE } from "@/lib/auth/session-cookie";
import { defaultLocale, localePrefix, locales } from "@/i18n/routing";

const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix,
});

/** Path (after the locale prefix) is public and never requires auth. */
function isPublicPath(pathWithoutLocale: string): boolean {
  return pathWithoutLocale === "/login" || pathWithoutLocale.startsWith("/login/");
}

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // The OAuth redirect target is locale-agnostic and always public.
  if (pathname === "/callback") {
    return NextResponse.next();
  }

  // Strip the leading /{locale} to evaluate the route group.
  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0];
  const hasLocale = (locales as readonly string[]).includes(maybeLocale ?? "");
  const locale = hasLocale ? (maybeLocale as string) : defaultLocale;
  const pathWithoutLocale = hasLocale ? `/${segments.slice(1).join("/")}` : pathname;

  const authed = request.cookies.get(AUTH_COOKIE)?.value === "1";

  if (!authed && !isPublicPath(pathWithoutLocale)) {
    const loginUrl = new URL(`/${locale}/login`, request.url);
    loginUrl.searchParams.set("from", pathWithoutLocale);
    return NextResponse.redirect(loginUrl);
  }

  return intlMiddleware(request);
}

export const config = {
  // Run on everything except API, Next internals and static assets.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
