"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { ReopenDestino } from "@/lib/schemas/messaging";
import type { Conversation } from "@/lib/types/messaging";

interface ReopenArgs {
  conversation_id: string;
  destino: ReopenDestino;
}

export function useReopenConversation() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: ReopenArgs) =>
      apiClient.post<{ data: { conversation: Conversation | null; destino: ReopenDestino } }>(
        `/api/v1/conversations/${args.conversation_id}/reopen`,
        { destino: args.destino },
      ),
    onError: (err, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
      showApiError(err);
    },
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      // As contagens das abas: a conversa trocou de aba e o número tem que acompanhar.
      qc.invalidateQueries({ queryKey: ["conversation-counts"] });
      qc.invalidateQueries({ queryKey: ["conversation", args.conversation_id] });
    },
  });
}
