"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { AppointmentRecord, MessageRecord } from "@/lib/api/types";

export function useMessages(patientId: string): UseQueryResult<MessageRecord[]> {
  return useQuery({
    queryKey: queryKeys.messages(patientId),
    enabled: Boolean(patientId),
    queryFn: () =>
      apiClient.get<MessageRecord[]>("/messages", { query: { patient: patientId } }),
  });
}

export interface SendMessageInput {
  patientId: string;
  body: string;
}

export function useSendMessage(): UseMutationResult<MessageRecord, Error, SendMessageInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiClient.post<MessageRecord>("/messages", {
        patientId: input.patientId,
        body: input.body,
      }),
    onSuccess: (_data, input) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(input.patientId) });
    },
  });
}

export function useAppointments(patientId: string): UseQueryResult<AppointmentRecord[]> {
  return useQuery({
    queryKey: queryKeys.appointments(patientId),
    enabled: Boolean(patientId),
    queryFn: () =>
      apiClient.get<AppointmentRecord[]>("/appointments", { query: { patient: patientId } }),
  });
}
