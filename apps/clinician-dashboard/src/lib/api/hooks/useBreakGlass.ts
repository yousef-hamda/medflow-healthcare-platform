"use client";

import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { BreakGlassResponse } from "@/lib/api/types";

export interface BreakGlassInput {
  patientId: string;
  resourceType?: string;
  resourceId?: string;
  justification: string;
}

export function useBreakGlass(): UseMutationResult<
  BreakGlassResponse,
  Error,
  BreakGlassInput
> {
  return useMutation({
    mutationFn: (input) =>
      apiClient.post<BreakGlassResponse>("/abac/break-glass", {
        patientId: input.patientId,
        resourceType: input.resourceType ?? "Patient",
        resourceId: input.resourceId ?? input.patientId,
        justification: input.justification,
      }),
  });
}
