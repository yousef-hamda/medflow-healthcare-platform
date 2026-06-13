/**
 * Consumer contract: clinician-dashboard -> api-gateway.
 *
 * The dashboard is the CONSUMER; the api-gateway is the PROVIDER. Each
 * interaction below becomes an expectation in the generated pact, which the
 * gateway later verifies in its own pipeline (see README for the wiring).
 *
 * All identifiers and values are synthetic.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PactV3,
  MatchersV3,
  SpecificationVersion,
} from "@pact-foundation/pact";
import { afterAll, describe, expect, it } from "vitest";

const { like, eachLike, integerV2, decimal, string, uuid } = MatchersV3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const provider = new PactV3({
  consumer: "clinician-dashboard",
  provider: "api-gateway",
  dir: path.resolve(__dirname, "..", "pacts"),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
});

describe("clinician-dashboard -> api-gateway contract", () => {
  afterAll(() => {
    // PactV3 writes the pact when the executeTest callbacks resolve; nothing to
    // tear down here, but keep the hook for symmetry / future state.
  });

  it("GET /worklist returns an array of patient risk entries", async () => {
    provider
      .given("there are patients on the worklist")
      .uponReceiving("a request for the clinician worklist")
      .withRequest({ method: "GET", path: "/worklist" })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: eachLike({
          patientId: uuid("8f0e2a1c-1d3b-4c5e-9a7f-2b6c0d4e8f10"),
          riskScores: like({
            sepsis: decimal(0.42),
            readmission: decimal(0.18),
          }),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/worklist`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{
        patientId: string;
        riskScores: Record<string, number>;
      }>;
      expect(Array.isArray(body)).toBe(true);
      expect(body[0]).toHaveProperty("patientId");
      expect(body[0]).toHaveProperty("riskScores");
    });
  });

  it("GET /fhir/Patient/{id} returns a FHIR Patient resource", async () => {
    const patientId = "8f0e2a1c-1d3b-4c5e-9a7f-2b6c0d4e8f10";

    provider
      .given("patient 8f0e2a1c exists")
      .uponReceiving("a request for a FHIR Patient by id")
      .withRequest({ method: "GET", path: `/fhir/Patient/${patientId}` })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/fhir+json" },
        body: like({
          resourceType: "Patient",
          id: string(patientId),
          active: like(true),
          name: eachLike({
            family: string("Synthetic"),
            given: eachLike(string("Patient")),
          }),
          gender: string("female"),
          birthDate: string("1980-01-01"),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/fhir/Patient/${patientId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { resourceType: string; id: string };
      expect(body.resourceType).toBe("Patient");
      expect(body.id).toBe(patientId);
    });
  });

  it("POST /analytics/cohort returns a count and demographics breakdown", async () => {
    provider
      .given("cohort analytics are available")
      .uponReceiving("a cohort analytics request")
      .withRequest({
        method: "POST",
        path: "/analytics/cohort",
        headers: { "Content-Type": "application/json" },
        body: {
          criteria: like({
            condition: "sepsis",
            ageMin: 18,
            ageMax: 90,
          }),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: like({
          count: integerV2(1234),
          demographics: like({
            ageBands: like({ "18-39": integerV2(300) }),
            gender: like({ female: integerV2(640), male: integerV2(594) }),
          }),
        }),
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/analytics/cohort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          criteria: { condition: "sepsis", ageMin: 18, ageMax: 90 },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        count: number;
        demographics: unknown;
      };
      expect(typeof body.count).toBe("number");
      expect(body).toHaveProperty("demographics");
    });
  });
});
