"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { CriarMembroInput } from "@/lib/schemas/team";

interface CriarResult {
  data: {
    user_id: string;
    role: string;
    /**
     * `false` quando já existia uma conta com aquele e-mail — a pessoa foi
     * VINCULADA à organização e entra com a senha que já tinha. Quem opera
     * precisa saber, senão repassa uma senha que não funciona.
     */
    conta_criada: boolean;
  };
}

export function useCriarMembro() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarMembroInput) =>
      apiClient.post<CriarResult>("/api/v1/team/criar", input),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
