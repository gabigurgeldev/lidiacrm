"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { EditarMembroInput } from "@/lib/schemas/team";

export function useEditarMembro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; dados: EditarMembroInput }) =>
      apiClient.patch<{ data: { user_id: string; changed: string[] } }>(
        `/api/v1/team/${args.userId}/dados`,
        args.dados,
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
