import type {
  CdsHooksResponse,
  CdsServicesDiscoveryResponse,
} from "@medflow/shared-types";

import { apiClient } from "@/lib/api/client";
import { env } from "@/lib/env";

/** Fetches the CDS Hooks discovery document. */
export async function fetchCdsServices(): Promise<CdsServicesDiscoveryResponse> {
  return apiClient.get<CdsServicesDiscoveryResponse>("/cds-services", {
    baseUrl: env.cdsUrl,
  });
}

export interface InvokeCdsArgs {
  serviceId: string;
  patientId: string;
  userId: string;
  encounterId?: string;
  fhirServer?: string;
}

/**
 * Invokes a single `patient-view` CDS service and returns its cards.
 * Generates a fresh hookInstance per call as required by the spec.
 */
export async function invokeCdsService(args: InvokeCdsArgs): Promise<CdsHooksResponse> {
  const hookInstance =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `hook-${Date.now()}`;

  const body = {
    hook: "patient-view",
    hookInstance,
    fhirServer: args.fhirServer ?? `${env.apiUrl}/fhir`,
    context: {
      userId: args.userId,
      patientId: args.patientId,
      ...(args.encounterId ? { encounterId: args.encounterId } : {}),
    },
  };

  return apiClient.post<CdsHooksResponse>(`/cds-services/${args.serviceId}`, body, {
    baseUrl: env.cdsUrl,
  });
}
