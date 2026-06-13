"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { WorklistItem } from "@/lib/api/types";

export function useWorklist(): UseQueryResult<WorklistItem[]> {
  return useQuery({
    queryKey: queryKeys.worklist(),
    queryFn: () => apiClient.get<WorklistItem[]>("/worklist"),
    refetchInterval: 60_000,
  });
}
