import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import { useAuthStore } from "@/lib/auth/store";
import type { UserMeResponse } from "@/lib/api/types";

export function useUserMe() {
  const setUser = useAuthStore((s) => s.setUser);
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async (): Promise<UserMeResponse> => {
      const me = await apiClient.get<UserMeResponse>("/users/me");
      setUser({ id: me.id, name: me.name, email: me.email, patientId: me.patientId });
      return me;
    },
    staleTime: 5 * 60 * 1000,
  });
}
