"use client";

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { CohortResponseRaw } from "@/lib/api/types";
import {
  criteriaToRequest,
  mapCohortResponse,
  type CohortCriterion,
  type NormalizedCohort,
} from "@/lib/cohort";

export function useCohort(): UseMutationResult<
  NormalizedCohort,
  Error,
  CohortCriterion[]
> {
  return useMutation({
    mutationFn: async (criteria) => {
      const raw = await apiClient.post<CohortResponseRaw>(
        "/analytics/cohort",
        criteriaToRequest(criteria),
      );
      return mapCohortResponse(raw);
    },
  });
}
