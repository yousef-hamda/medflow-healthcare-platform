import type { Page } from "@playwright/test";

/**
 * Mocks every MedFlow backend endpoint used by the clinician journey so the
 * default specs pass headless with NO backend running. `@live` specs skip this.
 */
export async function mockBackend(page: Page): Promise<void> {
  await page.route("**/users/me", (route) =>
    route.fulfill({
      json: { id: "dr-house", name: "Dr. House", role: "clinician", scopes: ["user/*.read"] },
    }),
  );

  await page.route("**/worklist", (route) =>
    route.fulfill({
      json: [
        {
          patientId: "p-001",
          name: "Jordan Rivera",
          mrn: "MRN-00012345",
          primaryScore: 0.82,
          primaryBand: "high",
          sepsisScore: 0.82,
          readmissionScore: 0.34,
          updatedAt: "2026-06-12T08:00:00.000Z",
        },
        {
          patientId: "p-002",
          name: "Avery Chen",
          mrn: "MRN-00067890",
          primaryScore: 0.21,
          primaryBand: "low",
          sepsisScore: 0.12,
          readmissionScore: 0.21,
          updatedAt: "2026-06-12T07:30:00.000Z",
        },
      ],
    }),
  );

  await page.route("**/fhir/Patient/**", (route) =>
    route.fulfill({
      json: {
        resourceType: "Patient",
        id: "p-001",
        name: [{ family: "Rivera", given: ["Jordan"] }],
        gender: "female",
        birthDate: "1980-05-04",
        identifier: [{ type: { coding: [{ code: "MR" }] }, value: "MRN-00012345" }],
      },
    }),
  );

  // Generic FHIR search → empty searchset bundle.
  await page.route("**/fhir/**", (route) => {
    if (route.request().url().includes("/fhir/Patient/")) return route.fallback();
    return route.fulfill({ json: { resourceType: "Bundle", type: "searchset", entry: [] } });
  });

  await page.route("**/ml/sepsis", (route) =>
    route.fulfill({
      json: {
        model: "sepsis",
        modelVersion: "v3.2.1",
        patientId: "p-001",
        score: 0.82,
        band: "high",
        topContributors: [
          { feature: "lactate", shapValue: 0.21, value: 3.4 },
          { feature: "heart_rate", shapValue: 0.14, value: 122 },
          { feature: "wbc", shapValue: 0.09, value: 14.2 },
        ],
      },
    }),
  );

  await page.route("**/ml/readmission", (route) =>
    route.fulfill({
      json: {
        model: "readmission",
        modelVersion: "v1.0.0",
        patientId: "p-001",
        score: 0.34,
        band: "low",
        topContributors: [{ feature: "prior_admissions", shapValue: 0.12, value: 2 }],
      },
    }),
  );

  await page.route("**/ml/chest-xray", (route) =>
    route.fulfill({ json: { model: "chest-xray", modelVersion: "v2", patientId: "p-001", score: 0.4, band: "medium", finding: "No acute findings" } }),
  );

  await page.route("**/cds-services", (route) => route.fulfill({ json: { services: [] } }));
  await page.route("**/cds-services/**", (route) => route.fulfill({ json: { cards: [] } }));

  await page.route("**/messages**", (route) => {
    if (route.request().method() === "POST") {
      return route.fulfill({
        json: { id: "m-new", patientId: "p-001", authorId: "dr-house", authorName: "Dr. House", body: "ok", ts: new Date().toISOString(), fromMe: true },
      });
    }
    return route.fulfill({ json: [] });
  });

  await page.route("**/appointments**", (route) => route.fulfill({ json: [] }));

  await page.route("**/abac/break-glass", (route) =>
    route.fulfill({ json: { granted: true, mrn: "MRN-00012345", auditId: "audit-1" } }),
  );

  await page.route("**/analytics/cohort", (route) =>
    route.fulfill({
      json: {
        count: 128,
        demographics: {
          ageBuckets: [
            { bucket: "18-39", count: 40 },
            { bucket: "40-64", count: 58 },
            { bucket: "65+", count: 30 },
          ],
          gender: { male: 70, female: 58 },
        },
      },
    }),
  );

  await page.route("**/analytics/audit**", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: "a-1",
            ts: "2026-06-12T08:00:00.000Z",
            actorId: "dr-house",
            actorRole: "clinician",
            action: "GET /fhir/Patient",
            resourceType: "Patient",
            resourceId: "p-001",
            justification: "Routine review",
          },
        ],
        page: 0,
        pageSize: 20,
        total: 1,
        chainValid: true,
      },
    }),
  );

  await page.route("**/admin/models", (route) =>
    route.fulfill({
      json: [
        {
          id: "sepsis",
          name: "Sepsis Early Warning",
          production: { version: "v3.2.1", auroc: 0.91, aurocHistory: [0.88, 0.89, 0.9, 0.91] },
          canary: { version: "v3.3.0-rc1", auroc: 0.92 },
          fairness: [{ subgroup: "age 65+", metric: "TPR", value: 0.87 }],
          modelCard: "# Sepsis Model\n\n**Intended use:** early warning.\n\n- Synthetic data only",
        },
      ],
    }),
  );

  // Socket.IO polling handshake → keep it from erroring the console.
  await page.route("**/socket.io/**", (route) => route.fulfill({ status: 200, body: "" }));
}

/** Logs in via the standalone form and lands on the worklist. */
export async function login(page: Page, locale = "en"): Promise<void> {
  await page.goto(`/${locale}/login`);
  await page.getByLabel(/username/i).fill("dr-house");
  await page.getByLabel(/password/i).fill("secret");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(`**/${locale}/worklist`);
}
