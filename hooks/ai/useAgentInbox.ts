"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import type { AgentInboxSeverity } from "@/lib/ai/agent-inbox-copy";

export interface AgentInboxItem {
  id: string;
  kind: string;
  severity: AgentInboxSeverity;
  title: string;
  body: string | null;
  ref_kind: string | null;
  ref_id: string | null;
  status: "open" | "ack" | "resolved";
  created_at: string;
  /** Só nos avisos `knowledge_gap` (migration 0245): a pergunta que o material não responde. */
  lacuna?: AgentInboxLacuna;
}

export interface AgentInboxLacuna {
  id: string;
  pergunta: string;
  ocorrencias: number;
  status: "aberta" | "respondida" | "descartada";
}

export interface AgentInboxData {
  items: AgentInboxItem[];
  open_count: number;
}

/** Central de avisos do runtime (F1). Polling 60s — avisos nascem no worker. */
export function useAgentInbox(status: "open" | "resolved" = "open") {
  return useQuery({
    queryKey: ["agent-inbox", status],
    refetchInterval: 60_000,
    queryFn: () =>
      apiClient
        .get<{ data: AgentInboxData }>(`/api/v1/ai/inbox?status=${status}`)
        .then((r) => r.data),
  });
}

export function useUpdateInboxItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "resolved" }) =>
      apiClient.patch(`/api/v1/ai/inbox/${id}`, { status }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent-inbox"] }),
  });
}

/**
 * Central de lacunas (0245): ensinar a resposta ou descartar a pergunta.
 * Fecha o aviso no servidor, então a lista é recarregada.
 */
export function useResolverLacuna() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: { id: string; acao: "ensinar"; pergunta: string; resposta: string } | { id: string; acao: "descartar" },
    ) => {
      const { id, ...corpo } = input;
      return apiClient.patch(`/api/v1/ai/lacunas/${id}`, corpo);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["agent-inbox"] }),
  });
}
