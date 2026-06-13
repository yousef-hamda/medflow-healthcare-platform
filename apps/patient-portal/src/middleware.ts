import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { locales, defaultLocale, localePrefix } from "@/i18n/routing";

const AUTH_COOKIE = "mf_authed";

const intlMiddleware = createMiddleware({
  locales,
  defaultLocale,
  localePrefix,
});

/** Strips the leading locale segment, returning the in-locale path ("/me/results"). */
function pathWithoutLocale(pathname: string): { locale: string; rest: string } {
  const segments = pathname.split("/").filter(Boolean);
  const maybeLocale = segments[0];
  if ((locales as readonly string[]).includes(maybeLocale)) {
    return { locale: maybeLocale, rest: "/" + segments.slice(1).join("/") };
  }
  return { locale: defaultLocale, rest: pathname };
}

export default function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const { locale, rest } = pathWithoutLocale(pathname);

  // Protected routes: /{locale}/me/*
  const isProtected = rest === "/me" || rest.startsWith("/me/");
  if (isProtected) {
    const authed = request.cookies.get(AUTH_COOKIE)?.value;
    if (!authed) {
      const loginUrl = new URL(`/${locale}/login`, request.url);
      loginUrl.searchParams.set("redirect", rest);
      return NextResponse.redirect(loginUrl);
    }
  }

  return intlMiddleware(request);
}

export const config = {
  // Skip api, _next, static assets and favicon.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
