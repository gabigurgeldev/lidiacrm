"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";
import type { CriarMensagemAgendada, MensagemAgendada } from "@/lib/schemas/mensagem-agendada";

const chave = (conversationId: string) => ["conversation", conversationId, "scheduled"] as const;

/**
 * O que está marcado para sair nesta conversa. `enabled` deixa quem mostra a
 * lista só num diálogo aberto não pagar a busca a cada render.
 */
export function useScheduledMessages(conversationId: string | null, enabled = true) {
  return useQuery({
    queryKey: chave(conversationId ?? ""),
    enabled: enabled && conversationId !== null,
    queryFn: async () =>
      (
        await apiClient.get<{ data: MensagemAgendada[] }>(
          `/api/v1/conversations/${conversationId}/scheduled-messages`,
        )
      ).data,
    staleTime: 15_000,
  });
}

export function useAgendarMensagem(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CriarMensagemAgendada) =>
      (
        await apiClient.post<{ data: MensagemAgendada }>(
          `/api/v1/conversations/${conversationId}/scheduled-messages`,
          input,
        )
      ).data,
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(conversationId) }),
  });
}

export function useDesmarcarMensagem(conversationId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (scheduledId: string) =>
      apiClient.delete<void>(
        `/api/v1/conversations/${conversationId}/scheduled-messages/${scheduledId}`,
      ),
    onError: showApiError,
    onSuccess: () => qc.invalidateQueries({ queryKey: chave(conversationId) }),
  });
}
