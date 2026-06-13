import { describe, expect, it } from "vitest";

import {
  isBundle,
  isFhirResource,
  isObservation,
  isOperationOutcome,
  isPatient,
  resourcesOfType,
} from "./guards.js";
import type { Bundle, Observation, Patient, Resource } from "./resources.js";

const patient: Patient = {
  resourceType: "Patient",
  id: "pat-1",
  name: [{ family: "Synthetic", given: ["Casey"] }],
  birthDate: "1984-02-11",
};

const observation: Observation = {
  resourceType: "Observation",
  status: "final",
  code: { coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }] },
  subject: { reference: "Patient/pat-1" },
  valueQuantity: { value: 92, unit: "beats/minute", system: "http://unitsofmeasure.org", code: "/min" },
};

describe("isFhirResource", () => {
  it("accepts objects with a non-empty resourceType", () => {
    expect(isFhirResource(patient)).toBe(true);
  });

  it.each([null, undefined, 42, "Patient", {}, { resourceType: "" }, { resourceType: 7 }])(
    "rejects %j",
    (value) => {
      expect(isFhirResource(value)).toBe(false);
    },
  );
});

describe("resource guards", () => {
  it("narrows by resourceType", () => {
    expect(isPatient(patient)).toBe(true);
    expect(isPatient(observation)).toBe(false);
    expect(isObservation(observation)).toBe(true);
    expect(
      isOperationOutcome({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "processing" }] }),
    ).toBe(true);
  });
});

describe("bundles", () => {
  const bundle: Bundle<Resource> = {
    resourceType: "Bundle",
    type: "searchset",
    total: 3,
    entry: [{ resource: patient }, { resource: observation }, {}],
  };

  it("isBundle identifies bundles", () => {
    expect(isBundle(bundle)).toBe(true);
    expect(isBundle(patient)).toBe(false);
  });

  it("resourcesOfType extracts matching typed resources and skips empty entries", () => {
    const observations = resourcesOfType(bundle, isObservation);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.valueQuantity?.value).toBe(92);
    expect(resourcesOfType(bundle, isPatient)).toHaveLength(1);
  });
});
