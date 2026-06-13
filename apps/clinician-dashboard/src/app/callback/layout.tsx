import { themeInitScript } from "@medflow/ui";
import type { ReactNode } from "react";

import "@/app/globals.css";

/**
 * Standalone root layout for the OAuth redirect target. It lives outside the
 * [locale] tree (the IdP redirects to a fixed /callback URI), so it provides its
 * own <html>/<body>.
 */
export default function CallbackLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="min-h-screen bg-background text-foreground">{children}</body>
    </html>
  );
}
