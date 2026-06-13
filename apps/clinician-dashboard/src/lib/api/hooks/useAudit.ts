"use client";

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { AuditPage } from "@/lib/api/types";

export interface AuditQueryParams {
  page: number;
  pageSize: number;
  actor?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
}

export function useAudit(params: AuditQueryParams): UseQueryResult<AuditPage> {
  const queryParams: Record<string, unknown> = {
    page: params.page,
    pageSize: params.pageSize,
    actor: params.actor || undefined,
    action: params.action || undefined,
    resourceType: params.resourceType || undefined,
    from: params.from || undefined,
    to: params.to || undefined,
  };

  return useQuery({
    queryKey: queryKeys.audit(queryParams),
    placeholderData: keepPreviousData,
    queryFn: () =>
      apiClient.get<AuditPage>("/analytics/audit", {
        query: queryParams as Record<string, string | number | boolean | undefined>,
      }),
  });
}
