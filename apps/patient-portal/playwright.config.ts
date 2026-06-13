import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the patient portal.
 *
 * Default specs mock ALL network via page.route and are runnable with NO
 * backend. Specs tagged with "@live" hit the real backend and are skipped
 * unless PW_LIVE=1 is set.
 */
const PORT = 3001;
const baseURL = process.env.PW_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  grepInvert: process.env.PW_LIVE ? undefined : /@live/,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PW_NO_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
