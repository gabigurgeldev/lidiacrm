"use client";

import { useQuery } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { DetalheDoAgendamento } from "@/lib/agenda/contrato";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";

/**
 * Um agendamento por inteiro — `GET /api/v1/agenda/agendamentos/{id}`.
 *
 * A grade carrega o MÍNIMO para desenhar (hora, cor, título, com quem); o que o
 * detalhe mostra — telefone, profissionais com papel, notas, conversa, lead,
 * lembrete — custa junções que não fazem sentido para cem blocos de uma semana.
 * Por isso uma ida própria, sob `["agenda", "detalhe", id]`: toda mutação da
 * agenda invalida `["agenda"]` e o Realtime invalida `detalhe`, então o que está
 * aberto acompanha o que mudou.
 *
 * O 404 NÃO vira toast. Ele é o caso normal de um link `?agendamento=` antigo, de
 * outra organização ou de compromisso de outra pessoa que a RLS não deixa ver —
 * quem explica é o próprio painel ("este agendamento não está disponível"), no
 * lugar onde a pessoa está olhando, e não um aviso de erro no canto.
 */
export function useDetalheDoAgendamento(id: string | null) {
  return useQuery({
    queryKey: ["agenda", "detalhe", id],
    enabled: id !== null,
    retry: (falhas, err) => !(err instanceof ApiError && err.status === 404) && falhas < 2,
    queryFn: async (): Promise<DetalheDoAgendamento> => {
      try {
        const r = await apiClient.get<{ data: DetalheDoAgendamento }>(
          `/api/v1/agenda/agendamentos/${id}`,
        );
        return (r as unknown as { data?: DetalheDoAgendamento }).data ?? (r as unknown as DetalheDoAgendamento);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) showApiError(err);
        throw err;
      }
    },
  });
}
