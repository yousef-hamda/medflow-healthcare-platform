"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { CurrentUser } from "@/lib/api/types";

export function useUserMe(): UseQueryResult<CurrentUser> {
  return useQuery({
    queryKey: queryKeys.userMe(),
    queryFn: () => apiClient.get<CurrentUser>("/users/me"),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
