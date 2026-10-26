"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { ehEcoLocal } from "@/lib/kanban/local-echo";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";
import { apiClient } from "@/lib/api/client";
import type { BoardData } from "@/lib/kanban/types";

/**
 * Fetch board via API route (NOT direct supabase-js).
 *
 * Why: the auth cookie `sb-deskcomm-auth` is httpOnly so the browser Supabase
 * client cannot read it — auth.uid() ends up null, RLS hides the pipeline,
 * and PostgREST returns PGRST116. Routing through /api/v1/pipelines/[id]/board
 * uses the server-side cookie reader, identical to every other authed query.
 */
async function fetchBoard(pipelineId: string): Promise<BoardData> {
  const res = await apiClient.get<{ data: BoardData }>(
    `/api/v1/pipelines/${pipelineId}/board`,
  );
  // apiClient unwraps { data, meta } envelope already in some helpers;
  // ours returns the parsed JSON literally. Handle both shapes safely.
  if (res && typeof res === "object" && "data" in res) {
    return (res as { data: BoardData }).data;
  }
  return res as unknown as BoardData;
}

/**
 * Quanto tempo o card fica marcado como "acabou de chegar".
 *
 * NÃO é para bater com `--duration-slow` (320ms) do CSS, e a diferença é
 * DELIBERADA: com movimento normal a animação dura os 320ms e o resto da
 * janela é invisível; com `prefers-reduced-motion` o fundo estático fica os
 * 1200ms inteiros, que é o que torna a alternativa perceptível — 320ms de
 * fundo estático ninguém vê. Alinhar os dois números "para consertar a
 * divergência" apaga a pista de acessibilidade.
 */
const PULSE_MS = 1_200;

/**
 * Janela para juntar eventos Realtime num refetch só.
 *
 * Antes, CADA evento de `crm_leads` refazia o GET inteiro do quadro (pipeline,
 * etapas, todos os leads e quatro enriquecimentos). Mover um card gera dois
 * eventos (o movimento e o carimbo de `last_activity_at`); uma automação que
 * move 30 negócios gerava 60 refetches em sequência. Agora o UPDATE é aplicado
 * no cache NA HORA (ver `COLUNAS_DO_EVENTO`) e a reconciliação com o servidor
 * acontece uma vez, quando os eventos param de chegar.
 */
const RECONCILIAR_MS = 600;

/**
 * As colunas de `crm_leads` que um UPDATE do Realtime pode sobrescrever no card
 * sem refetch. Só colunas da PRÓPRIA linha: o que é derivado (dono agente,
 * score, conversa, tags do contato) só o servidor monta — a reconciliação traz.
 */
const COLUNAS_DO_EVENTO = [
  "stage_id",
  "position_in_stage",
  "status",
  "title",
  "value_cents",
  "currency",
  "owner_user_id",
  "owner_kind",
  "owner_agent_id",
  "tags",
  "updated_at",
  "last_activity_at",
  "stage_changed_at",
  "closed_at",
  "lost_reason",
  "expected_close_date",
] as const;

export function aplicaEventoNoQuadro(board: BoardData | undefined, payload: unknown): BoardData | undefined {
  if (!board || !payload || typeof payload !== "object") return board;
  const p = payload as { eventType?: string; new?: Record<string, unknown> };
  const novo = p.new;
  if (p.eventType !== "UPDATE" || !novo || typeof novo.id !== "string") return board;
  let mudou = false;
  const leads = board.leads.map((lead) => {
    if (lead.id !== novo.id) return lead;
    const patch: Record<string, unknown> = {};
    for (const col of COLUNAS_DO_EVENTO) if (col in novo) patch[col] = novo[col];
    mudou = true;
    return { ...lead, ...patch };
  });
  return mudou ? { ...board, leads } : board;
}

/** O id do lead dentro do payload do postgres_changes (new, ou old no delete). */
function idDoEvento(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { new?: { id?: unknown }; old?: { id?: unknown } };
  const id = p.new?.id ?? p.old?.id;
  return typeof id === "string" ? id : null;
}

export function useBoard(pipelineId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["board", pipelineId] as const;

  /**
   * Cards que acabaram de mudar POR EVENTO REMOTO — o pulso da Wave 3.
   *
   * Só entra aqui o que veio de fora: a própria ação já tem feedback (o card se
   * move sob o cursor) e pulsar nela seria ruído com cara de novidade. Cada id
   * sai sozinho depois de PULSE_MS: o pulso acontece UMA vez e cessa, em vez de
   * virar destaque persistente.
   */
  const [pulses, setPulses] = useState<Map<string, number>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const reconciliacao = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = useQuery({
    queryKey,
    queryFn: () => fetchBoard(pipelineId as string),
    enabled: !!pipelineId,
  });

  const onChange = useCallback(
    (payload: unknown) => {
      // O UPDATE entra no cache na hora; o refetch é UM, quando os eventos
      // param (ver RECONCILIAR_MS). INSERT/DELETE só a reconciliação resolve.
      qc.setQueryData<BoardData>(queryKey, (atual) => aplicaEventoNoQuadro(atual, payload));
      if (reconciliacao.current) clearTimeout(reconciliacao.current);
      reconciliacao.current = setTimeout(() => {
        reconciliacao.current = null;
        void qc.invalidateQueries({ queryKey });
      }, RECONCILIAR_MS);

      const leadId = idDoEvento(payload);
      // Janela, não marca gasta por evento: uma ação minha chega aqui em DUAS
      // parcelas (o movimento e o carimbo de `last_activity_at` da atividade).
      if (!leadId || ehEcoLocal(leadId)) return;

      // CONTADOR, não booleano. Com um Set, o segundo evento remoto no mesmo
      // card dentro da janela não mudava nada: o id já estava lá, a classe
      // nunca saía do elemento e a animação CSS não reinicia sem a classe
      // sair — pior, o timeout do primeiro evento apagava tudo no meio do
      // segundo. Chegava coisa de fora e a tela não dizia nada, que é o pecado
      // que esta peça existe para matar.
      setPulses((atual) => {
        const proximo = new Map(atual);
        proximo.set(leadId, (proximo.get(leadId) ?? 0) + 1);
        return proximo;
      });

      // Cada evento reinicia a contagem: a janela é do ÚLTIMO evento.
      const anterior = timers.current.get(leadId);
      if (anterior) clearTimeout(anterior);
      timers.current.set(
        leadId,
        setTimeout(() => {
          timers.current.delete(leadId);
          setPulses((atual) => {
            if (!atual.has(leadId)) return atual;
            const proximo = new Map(atual);
            proximo.delete(leadId);
            return proximo;
          });
        }, PULSE_MS),
      );
    },
    [qc, queryKey],
  );

  // O STATUS DO CANAL NÃO PODE SER DESCARTADO. `useRealtimeChannel` calcula
  // SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED e, sem atribuir o retorno,
  // esse valor morria na linha seguinte — enquanto ele é o único que separa
  // DUAS FAMÍLIAS INTEIRAS de causa: "a assinatura morreu" e "nada aconteceu"
  // têm exatamente a mesma aparência na tela, que é silêncio.
  //
  // Assinatura que morre calada é peça sem sinal de vida: o "log morto" do
  // checklist do sistema vivo, na versão cara, porque a tela continua parecendo
  // certa enquanto o board já não escuta mais nada.
  const { status: realtimeStatus, ultimaEntrega } = useRealtimeChannel({
    name: pipelineId ? `kanban-${pipelineId}` : "kanban-disabled",
    postgresChanges: pipelineId
      ? {
          event: "*",
          schema: "public",
          table: "crm_leads",
          filter: `pipeline_id=eq.${pipelineId}`,
        }
      : undefined,
    onChange,
    enabled: !!pipelineId,
  });

  // Timers pendentes morrem com o componente — senão um setState chega depois
  // do unmount e o React reclama (e o Map de timers vaza).
  useEffect(() => {
    const pendentes = timers.current;
    const recon = reconciliacao;
    return () => {
      for (const t of pendentes.values()) clearTimeout(t);
      pendentes.clear();
      if (recon.current) clearTimeout(recon.current);
    };
  }, []);

  // A REDE DE SEGURANÇA. Sem ela, um canal que para de entregar deixa o board
  // congelado num passado que parece presente — e nem voltar para a aba
  // conserta. A assinatura é a contagem de leads mais o maior `updated_at`: é
  // sensível a exatamente o que o canal deveria ter trazido (lead novo, lead
  // movido, lead editado) e barata de calcular a cada verificação.
  const seguranca = useRefetchDeSeguranca<BoardData>({
    queryKey,
    assinatura: (d) => {
      const leads = d?.leads ?? [];
      let maior = "";
      for (const l of leads) {
        const u = (l as { updated_at?: string }).updated_at ?? "";
        if (u > maior) maior = u;
      }
      return `${leads.length}:${maior}`;
    },
    ultimaEntrega,
    enabled: !!pipelineId,
  });

  return { ...query, pulses, realtimeStatus, seguranca };
}
