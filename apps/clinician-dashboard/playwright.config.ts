import { defineConfig, devices } from "@playwright/test";

/**
 * Default specs mock ALL network with `page.route` and pass headless with NO
 * backend running. Specs tagged `@live` in their describe title exercise the
 * real MedFlow stack and are expected to be run with services up.
 *
 * The dev server (`webServer`) is optional and commented out: by default we
 * assume the app is already running on :3000 (CI starts it separately).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // webServer: {
  //   command: "pnpm dev",
  //   url: "http://localhost:3000",
  //   reuseExistingServer: !process.env.CI,
  //   timeout: 120_000,
  // },
});
