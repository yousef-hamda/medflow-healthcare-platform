"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { ModelInfo } from "@/lib/api/types";

export function useAdminModels(): UseQueryResult<ModelInfo[]> {
  return useQuery({
    queryKey: queryKeys.adminModels(),
    queryFn: () => apiClient.get<ModelInfo[]>("/admin/models"),
    staleTime: 60_000,
  });
}
