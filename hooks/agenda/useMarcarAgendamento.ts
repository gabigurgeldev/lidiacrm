"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import type { MarcarInput } from "@/lib/agenda/contrato";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

/**
 * O corpo de marcar é o do CONTRATO (`MarcarInput`), e não uma forma própria
 * desta tela: rota, ferramenta MCP e tela falam a mesma, e uma segunda
 * declaração aqui envelheceria calada no primeiro campo novo — foi o que
 * aconteceu com `professional_ids` e `conversation_id`, que a 0245 trouxe.
 */
export type NovoAgendamento = MarcarInput;

/**
 * Marca de verdade — `POST /api/v1/agenda/agendamentos`.
 *
 * Até este hook existir, o "Marcado ✓" que a tela mostrava era **estado local do
 * React**: `PainelDeMarcacao` chama `onConfirmar?.()`, a prop é OPCIONAL, e nem
 * a vitrine nem a tela do produto a passavam. A máquina de três tempos estava
 * provada; a criação da linha, não. Achado do maestro na auditoria dos dez itens.
 *
 * O `showApiError` cuida da recusa: os códigos de agenda já têm TOM declarado no
 * `ApiErrorToast` (warning para recusa esperada, error para configuração
 * quebrada) e deixam passar a mensagem da rota, que é mais específica do que
 * qualquer frase genérica — ela tem o nome do tipo e o motivo.
 *
 * ⚠️ O 409 `agenda_horario_ocupado` RECARREGA OS HORÁRIOS. Ele quer dizer que
 * alguém (outra pessoa da equipe, ou a IA numa conversa) pegou o horário entre
 * a tela mostrá-lo e o clique — a corrida que o índice único da 0245 fecha no
 * banco. Mostrar o erro e deixar a lista igual convidaria a clicar de novo no
 * mesmo horário morto.
 */
export function useMarcarAgendamento() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (novo: NovoAgendamento) => {
      return apiClient.post<{ data: { id: string; professional_ids?: string[] } }>(
        "/api/v1/agenda/agendamentos",
        novo,
      );
    },
    onSuccess: () => {
      // Sem exclamação e sem emoji — anti-pattern declarado do design system.
      toast.success(t("Agendamento criado."));
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
    onError: (err) => {
      showApiError(err);
      if (err instanceof ApiError && err.code === "agenda_horario_ocupado") {
        void qc.invalidateQueries({ queryKey: ["agenda", "horarios-livres"] });
      }
    },
  });
}
