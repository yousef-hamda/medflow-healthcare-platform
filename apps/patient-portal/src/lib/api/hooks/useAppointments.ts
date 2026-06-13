import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { Appointment, BookAppointmentInput } from "@/lib/api/types";

export function useAppointments() {
  return useQuery({
    queryKey: queryKeys.appointments,
    queryFn: async (): Promise<Appointment[]> => {
      const res = await apiClient.get<Appointment[] | { appointments: Appointment[] }>("/appointments");
      return Array.isArray(res) ? res : res.appointments;
    },
    staleTime: 30 * 1000,
  });
}

export function useBookAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookAppointmentInput): Promise<Appointment> => apiClient.post<Appointment>("/appointments", input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.appointments });
    },
  });
}

export function useCancelAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string): Promise<void> => apiClient.post<void>(`/appointments/${id}/cancel`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.appointments });
    },
  });
}
