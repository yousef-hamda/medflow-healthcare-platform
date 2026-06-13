import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { MessageThread, SendMessageInput } from "@/lib/api/types";

export function useMessages() {
  return useQuery({
    queryKey: queryKeys.messages,
    queryFn: async (): Promise<MessageThread[]> => {
      const res = await apiClient.get<MessageThread[] | { threads: MessageThread[] }>("/messages");
      return Array.isArray(res) ? res : res.threads;
    },
    staleTime: 15 * 1000,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendMessageInput): Promise<MessageThread> => apiClient.post<MessageThread>("/messages", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.messages });
    },
  });
}
