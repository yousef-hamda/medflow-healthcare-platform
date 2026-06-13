import { expect, test } from "@playwright/test";

import { login, mockBackend } from "./helpers";

test.describe("cohort builder (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("build criteria → preview count + charts → save/load → CSV export", async ({ page }) => {
    await login(page);
    await page.goto("/en/cohort");

    await expect(page.getByRole("heading", { name: /cohort builder/i })).toBeVisible();

    // The default age-range criterion triggers a debounced cohort preview.
    await expect(page.getByTestId("cohort-count")).toHaveText("128", { timeout: 5000 });

    // Charts render (accessible role="img").
    await expect(page.getByRole("img", { name: /bar chart of patient counts/i })).toBeVisible();
    await expect(page.getByRole("img", { name: /pie chart of the cohort/i })).toBeVisible();

    // Save the cohort, then confirm it appears in the saved list.
    await page.getByLabel(/cohort name/i).fill("Adults 18-90");
    await page.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText("Adults 18-90")).toBeVisible();

    // Load it back.
    await page.getByRole("button", { name: /^load$/i }).click();
    await expect(page.getByTestId("cohort-count")).toHaveText("128");

    // CSV export triggers a download.
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^cohort-\d+\.csv$/);
  });
});

test.describe("@live cohort builder (real backend)", () => {
  test("preview a cohort against the running analytics service", async ({ page }) => {
    await login(page);
    await page.goto("/en/cohort");
    await expect(page.getByRole("heading", { name: /cohort builder/i })).toBeVisible();
    await expect(page.getByTestId("cohort-count")).toBeVisible();
  });
});
