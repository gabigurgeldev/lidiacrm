"use client";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";

/** Onda 5.1: rascunho sob demanda (sem enviar), pelo agente no ar no número ou pelo que só sugere respostas (migration 0255). */
export function useDraftReply() {
  return useMutation({
    mutationFn: async (conversationId: string) =>
      apiClient.post<{ data: { draft: string } }>(`/api/v1/conversations/${conversationId}/draft-reply`, {}),
    onError: showApiError,
  });
}
