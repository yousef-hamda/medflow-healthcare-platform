"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type {
  CdsCard,
  CdsServicesDiscoveryResponse,
} from "@medflow/shared-types";

import { queryKeys } from "@/lib/api/query-keys";
import { fetchCdsServices, invokeCdsService } from "@/lib/cds";

export function useCdsServices(): UseQueryResult<CdsServicesDiscoveryResponse> {
  return useQuery({
    queryKey: queryKeys.cdsServices(),
    queryFn: fetchCdsServices,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export interface CdsCardsParams {
  serviceId: string;
  patientId: string;
  userId: string;
  encounterId?: string;
  enabled?: boolean;
}

export function useCdsCards(params: CdsCardsParams): UseQueryResult<CdsCard[]> {
  return useQuery({
    queryKey: queryKeys.cdsCards(params.serviceId, params.patientId),
    enabled: Boolean(params.serviceId && params.patientId) && (params.enabled ?? true),
    retry: false,
    queryFn: async () => {
      const response = await invokeCdsService({
        serviceId: params.serviceId,
        patientId: params.patientId,
        userId: params.userId,
        encounterId: params.encounterId,
      });
      return response.cards ?? [];
    },
  });
}
