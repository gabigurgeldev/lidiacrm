"use client";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

/**
 * A trilha de uma execução — um evento por nó visitado, ao vivo.
 *
 * `flow_execution_events` existe desde a migration 0203 e nenhuma tela a
 * mostrava. É ela que responde "onde o fluxo está agora" e "quanto tempo
 * levou entre um passo e outro" — a leitura que mediu os 59,1s de retomada que
 * o laço do motor consertou.
 */
export interface PassoDaExecucao {
  id: string;
  node_id: string | null;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

/**
 * O que cada tipo de evento quer dizer, em português de gente.
 *
 * Dicionário aqui e não na tela porque a trilha aparece em mais de um lugar
 * (a lista e o detalhe), e dois dicionários divergiriam no primeiro tipo novo.
 * Tipo desconhecido cai no próprio nome — melhor mostrar o cru do que esconder
 * o passo.
 */
export const NOME_DO_PASSO: Record<string, string> = {
  no_avancou: "Avançou",
  espera_iniciada: "Começou a esperar",
  espera_por_evento: "Aguardando o cliente",
  fluxo_concluido: "Concluído",
  fluxo_morreu: "Parou",
  no_falhou: "Falhou",
  frente_concluiu: "Caminho concluído",
};

export function useTrilhaDaExecucao(execucaoId: string | null) {
  const qc = useQueryClient();
  const orgId = useActiveOrg()?.orgId ?? null;
  const queryKey = ["flow-execution-trail", execucaoId ?? "nenhuma"];

  const query = useQuery({
    queryKey,
    enabled: execucaoId !== null,
    queryFn: () =>
      apiClient
        .get<{ data: PassoDaExecucao[] }>(`/api/v1/flows/executions/${execucaoId}/events`)
        .then((r) => r.data),
  });

  const onChange = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["flow-execution-trail"] });
  }, [qc]);

  // Filtro por EXECUÇÃO: aqui a tela olha uma só, e o volume de eventos do
  // motor inteiro numa org movimentada encheria o canal à toa.
  useRealtimeChannel({
    name: execucaoId ? `flow-trail-${execucaoId}` : "flow-trail-disabled",
    postgresChanges:
      execucaoId && orgId
        ? {
            event: "INSERT",
            schema: "public",
            table: "flow_execution_events",
            filter: `execution_id=eq.${execucaoId}`,
          }
        : undefined,
    onChange,
    enabled: execucaoId !== null && !!orgId,
  });

  return query;
}

/**
 * Segundos entre um passo e o anterior. `null` no primeiro — não há "anterior".
 *
 * É o número que torna a lentidão visível sem abrir o banco: era 59,1s numa
 * retomada, contra 0,1–0,9s entre nós.
 */
export function segundosDesdeOPassoAnterior(
  passos: readonly PassoDaExecucao[],
  indice: number,
): number | null {
  if (indice <= 0) return null;
  const atual = passos[indice];
  const anterior = passos[indice - 1];
  if (!atual || !anterior) return null;
  const ms = new Date(atual.created_at).getTime() - new Date(anterior.created_at).getTime();
  return Math.max(0, Math.round(ms / 100) / 10);
}
