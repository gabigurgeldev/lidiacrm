"use client";
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { useActiveOrg } from "@/hooks/auth/AuthProvider";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";

/** O contato como a tela precisa dele: um nome para ler e um telefone para conferir. */
export interface ContatoDaExecucao {
  id: string;
  display_name: string | null;
  name: string | null;
  phone_number: string | null;
}

export interface ExecucaoDeFluxo {
  id: string;
  flow_id: string;
  version_id: string;
  status: string;
  current_node_id: string;
  outcome: string | null;
  last_error: string | null;
  attempts: number;
  steps_taken: number;
  lead_id: string | null;
  contact_id: string | null;
  started_at: string;
  completed_at: string | null;
  next_eval_at: string | null;
  /**
   * QUEM disparou. Vem embutido da rota, e pode ser nulo: `contact_id` só é
   * preenchido quando o payload do evento o trazia (ver `trigger-matcher.ts`).
   * Por isso o lead vem junto — ele é o desempate.
   */
  contato: ContatoDaExecucao | null;
  lead: { id: string; title: string | null; contato: ContatoDaExecucao | null } | null;
}

/**
 * O contato desta execução, com o desempate escrito num lugar só.
 *
 * `contact_id` é nulo em gatilho que nasce de lead; ali quem sabe do contato é
 * o lead. Sem esta função a regra viveria espalhada por cada tela que mostra
 * execução — e a segunda cópia mostraria "sem contato" onde a primeira mostra
 * o nome.
 */
export function contatoDaExecucao(e: ExecucaoDeFluxo): ContatoDaExecucao | null {
  return e.contato ?? e.lead?.contato ?? null;
}

/** O nome que a tela mostra, com o telefone como último recurso. */
export function nomeDoContato(c: ContatoDaExecucao | null): string | null {
  if (c === null) return null;
  return c.display_name ?? c.name ?? c.phone_number ?? null;
}

/**
 * Rede de segurança, não o caminho principal.
 *
 * Era 30s "porque uma execução em espera muda de estado no ritmo do cron
 * (1×/min)" — as duas metades dessa frase mudaram: o motor agora roda em laço
 * de ~2s (`lib/flow-engine/loop.ts`) e a tela agora ouve o Realtime. Este
 * intervalo sobrou para o caso de o canal morrer sem avisar.
 */
const RECONFERIR_MS = 30_000;

export function useExecucoes(filtro: { status?: string; flowId?: string } = {}) {
  const qc = useQueryClient();
  const orgId = useActiveOrg()?.orgId ?? null;

  const params = new URLSearchParams();
  if (filtro.status !== undefined) params.set("status", filtro.status);
  if (filtro.flowId !== undefined) params.set("flow_id", filtro.flowId);
  const consulta = params.toString();

  const queryKey = ["flow-executions", filtro.status ?? "todas", filtro.flowId ?? "todos"];

  const query = useQuery({
    queryKey,
    refetchInterval: RECONFERIR_MS,
    queryFn: () =>
      apiClient
        .get<{ data: ExecucaoDeFluxo[] }>(
          `/api/v1/flows/executions${consulta === "" ? "" : `?${consulta}`}`,
        )
        .then((r) => r.data),
  });

  // Invalida o PREFIXO, não a chave exata: a mesma execução aparece na lista
  // "todas" e na do filtro aberto, e invalidar só uma deixa a outra velha.
  const onChange = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["flow-executions"] });
  }, [qc]);

  // O filtro é por organização e não por fluxo, mesmo quando a tela é de um
  // fluxo só: `postgres_changes` aceita UM filtro, e o de org é o que a RLS
  // já garante de qualquer jeito. Filtrar por fluxo aqui trocaria uma
  // invalidação barata a mais por perder eventos quando a tela muda de fluxo.
  const { status: realtimeStatus, ultimaEntrega } = useRealtimeChannel({
    name: orgId ? `flow-executions-${orgId}` : "flow-executions-disabled",
    postgresChanges: orgId
      ? {
          event: "*",
          schema: "public",
          table: "flow_executions",
          filter: `organization_id=eq.${orgId}`,
        }
      : undefined,
    onChange,
    enabled: !!orgId,
  });

  /**
   * A rede de segurança: canal morto com a aba em foco deixaria a tela
   * congelada num passado que parece presente — e numa tela cujo propósito é
   * mostrar o fluxo andando, isso é pior que não existir.
   *
   * A assinatura soma o que MUDA quando uma execução caminha: quantas são, e o
   * maior `steps_taken` mais estado. Contar linhas não bastaria — uma execução
   * que avança de bloco não cria linha nova.
   */
  const seguranca = useRefetchDeSeguranca<ExecucaoDeFluxo[]>({
    queryKey,
    assinatura: (d) => {
      const execucoes = d ?? [];
      let marca = "";
      for (const e of execucoes) marca += `${e.id}:${e.status}:${e.steps_taken};`;
      return `${execucoes.length}:${marca}`;
    },
    ultimaEntrega,
    enabled: !!orgId,
  });

  return { ...query, realtimeStatus, seguranca };
}
