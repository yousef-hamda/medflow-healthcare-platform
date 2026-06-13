import { expect, test } from "@playwright/test";

import { login, mockBackend } from "./helpers";

test.describe("clinician journey (mocked backend)", () => {
  test.beforeEach(async ({ page }) => {
    await mockBackend(page);
  });

  test("login → worklist → patient → tabs → break-glass MRN reveal", async ({ page }) => {
    await login(page);

    // Worklist renders the risk-ranked table.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Jordan Rivera")).toBeVisible();
    // MRN is masked in the worklist.
    await expect(page.getByText(/••••/).first()).toBeVisible();

    // Open the patient.
    await page.getByRole("link", { name: /open patient jordan rivera/i }).click();
    await page.waitForURL("**/patient/p-001");

    // Header shows the masked MRN.
    const mrn = page.getByTestId("mrn");
    await expect(mrn).toContainText("•");

    // Tabs are present.
    await expect(page.getByRole("tab", { name: /summary/i })).toBeVisible();
    await page.getByRole("tab", { name: /risk/i }).click();
    await expect(page.getByText(/sepsis risk/i)).toBeVisible();

    // Break-glass reveal flow.
    await page.getByRole("button", { name: /reveal mrn/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/justification/i).fill("Confirming identity before medication.");
    await dialog.getByRole("button", { name: /reveal and record/i }).click();

    // Full MRN now visible.
    await expect(mrn).toHaveText("MRN-00012345");
  });
});

test.describe("@live clinician journey (real backend)", () => {
  test("login and worklist against the running stack", async ({ page }) => {
    // No route mocking: requires the MedFlow gateway/realtime/CDS services up.
    await login(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
