import type { ReactNode } from "react";

/**
 * Root layout is intentionally minimal: the real <html>/<body> shell is
 * rendered by src/app/[locale]/layout.tsx so it can set lang/dir per locale.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
