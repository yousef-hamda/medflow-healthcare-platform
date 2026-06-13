/**
 * Consumer contract: api-gateway -> ml-serving.
 *
 * The api-gateway is the CONSUMER (it proxies prediction requests); ml-serving
 * is the PROVIDER. The gateway expects SHAP-explained risk responses with a
 * model_version it can surface to clinicians.
 *
 * All identifiers, vitals, and labs are synthetic.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PactV3,
  MatchersV3,
  SpecificationVersion,
} from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

const { like, eachLike, decimal, string, uuid } = MatchersV3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const provider = new PactV3({
  consumer: "api-gateway",
  provider: "ml-serving",
  dir: path.resolve(__dirname, "..", "pacts"),
  spec: SpecificationVersion.SPECIFICATION_VERSION_V3,
});

// Shared SHAP top-5 matcher: exactly the shape the dashboard renders.
const shapTop5 = () =>
  eachLike(
    {
      feature: string("lactate"),
      value: decimal(3.1),
      impact: decimal(0.27),
    },
    5,
  );

describe("api-gateway -> ml-serving contract", () => {
  it("POST /predict/sepsis returns a banded risk score with SHAP top-5", async () => {
    provider
      .given("the sepsis model is loaded")
      .uponReceiving("a sepsis prediction request")
      .withRequest({
        method: "POST",
        path: "/predict/sepsis",
        headers: { "Content-Type": "application/json" },
        body: {
          patient_id: uuid("8f0e2a1c-1d3b-4c5e-9a7f-2b6c0d4e8f10"),
          vitals_window: eachLike({
            ts: string("2026-06-01T12:00:00Z"),
            hr: like(98),
            sbp: like(112),
            temp_c: decimal(38.4),
            spo2: like(94),
            resp_rate: like(22),
          }),
          labs: like({
            wbc: decimal(13.2),
            lactate: decimal(3.1),
            creatinine: decimal(1.4),
          }),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          risk_score: decimal(0.73),
          risk_band: string("high"),
          shap_top5: shapTop5(),
          model_version: string("sepsis-lstm@2.3.1"),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/predict/sepsis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: "8f0e2a1c-1d3b-4c5e-9a7f-2b6c0d4e8f10",
          vitals_window: [
            {
              ts: "2026-06-01T12:00:00Z",
              hr: 98,
              sbp: 112,
              temp_c: 38.4,
              spo2: 94,
              resp_rate: 22,
            },
          ],
          labs: { wbc: 13.2, lactate: 3.1, creatinine: 1.4 },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        risk_score: number;
        risk_band: string;
        shap_top5: unknown[];
        model_version: string;
      };
      expect(typeof body.risk_score).toBe("number");
      expect(typeof body.risk_band).toBe("string");
      expect(body.shap_top5).toHaveLength(5);
      expect(body.model_version).toMatch(/@/);
    });
  });

  it("POST /predict/readmission returns a probability with SHAP top-5", async () => {
    provider
      .given("the readmission model is loaded")
      .uponReceiving("a readmission prediction request")
      .withRequest({
        method: "POST",
        path: "/predict/readmission",
        headers: { "Content-Type": "application/json" },
        body: {
          patient_id: uuid("8f0e2a1c-1d3b-4c5e-9a7f-2b6c0d4e8f10"),
          encounter_id: string("enc-001"),
          features: like({
            age: like(67),
            prior_admissions: like(3),
            length_of_stay: like(6),
            charlson_index: like(4),
          }),
        },
      })
      .willRespondWith({
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          probability: decimal(0.31),
          shap_top5: shapTop5(),
          model_version: string("readmission-xgb@1.7.0"),
        },
      });

    await provider.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/predict/readmission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: "8f0e2a1c-1d3b-4c5e-9a7f-2b6c0d4e8f10",
          encounter_id: "enc-001",
          features: {
            age: 67,
            prior_admissions: 3,
            length_of_stay: 6,
            charlson_index: 4,
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        probability: number;
        shap_top5: unknown[];
        model_version: string;
      };
      expect(typeof body.probability).toBe("number");
      expect(body.shap_top5).toHaveLength(5);
      expect(body.model_version).toMatch(/@/);
    });
  });
});
