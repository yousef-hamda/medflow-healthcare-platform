import { test, expect, type Page } from "@playwright/test";

/**
 * Mock FHIR Observation Bundle with two panels (Chemistry, Hematology) so we
 * can assert panel grouping and open a plain-language detail dialog. Glucose
 * uses LOINC 2345-7 which has a bundled explanation.
 */
const OBSERVATION_BUNDLE = {
  resourceType: "Bundle",
  type: "searchset",
  entry: [
    {
      resource: {
        resourceType: "Observation",
        id: "obs-glucose",
        status: "final",
        category: [{ text: "Chemistry" }],
        code: { text: "Glucose", coding: [{ system: "http://loinc.org", code: "2345-7", display: "Glucose" }] },
        valueQuantity: { value: 90, unit: "mg/dL" },
        referenceRange: [{ low: { value: 70, unit: "mg/dL" }, high: { value: 99, unit: "mg/dL" } }],
        effectiveDateTime: "2026-03-04T09:00:00Z",
      },
    },
    {
      resource: {
        resourceType: "Observation",
        id: "obs-hgb",
        status: "final",
        category: [{ text: "Hematology" }],
        code: { text: "Hemoglobin", coding: [{ system: "http://loinc.org", code: "718-7", display: "Hemoglobin" }] },
        valueQuantity: { value: 11, unit: "g/dL" },
        referenceRange: [{ low: { value: 13, unit: "g/dL" }, high: { value: 17, unit: "g/dL" } }],
        effectiveDateTime: "2026-03-01T09:00:00Z",
      },
    },
  ],
};

const USER_ME = { id: "patient-synthetic", name: "Demo Patient", email: "demo@example.com", patientId: "synthetic-patient-001" };

/** Routes ALL backend calls to deterministic fixtures so the spec needs no server. */
async function mockBackend(page: Page) {
  await page.route("**/users/me", (route) => route.fulfill({ json: USER_ME }));
  await page.route("**/fhir/Observation**", (route) => route.fulfill({ json: OBSERVATION_BUNDLE }));
  await page.route("**/fhir/**", (route) => route.fulfill({ json: { resourceType: "Bundle", type: "searchset", entry: [] } }));
}

/** Performs the mock login flow and lands on the authenticated portal. */
async function login(page: Page) {
  await page.goto("/en/login");
  await page.getByLabel(/email/i).fill("demo@example.com");
  await page.getByLabel(/password/i).fill("password123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/en\/me/);
}

test.describe("lab results", () => {
  test("groups results by panel and explains a result", async ({ page }) => {
    await mockBackend(page);
    await login(page);

    await page.goto("/en/me/results");

    // Panels render as section headings.
    await expect(page.getByText("Chemistry")).toBeVisible();
    await expect(page.getByText("Hematology")).toBeVisible();

    // The glucose result is present.
    await expect(page.getByRole("button", { name: "Glucose" }).first()).toBeVisible();

    // Open the detail dialog for glucose.
    await page.getByRole("button", { name: "Glucose" }).first().click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Plain-language explanation text from the LOINC map.
    await expect(dialog.getByText(/amount of sugar in your blood/i)).toBeVisible();
    // Your value + range surfaced.
    await expect(dialog.getByText("90 mg/dL")).toBeVisible();
  });
});

test.describe("lab results @live", () => {
  test("loads real results from the gateway", async ({ page }) => {
    // No mocking: this variant hits the real backend and is skipped unless PW_LIVE=1.
    await login(page);
    await page.goto("/en/me/results");
    await expect(page.getByRole("heading", { name: /lab results/i })).toBeVisible();
  });
});
