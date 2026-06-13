import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { CreateShareTokenInput, ShareTokenResponse } from "@/lib/api/types";

export function useCreateShareToken() {
  return useMutation({
    mutationFn: (input: CreateShareTokenInput): Promise<ShareTokenResponse> =>
      apiClient.post<ShareTokenResponse>("/share/tokens", input),
  });
}
