"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * A seção "Kanbans" do painel do inbox: em que coluna de cada Kanban o contato
 * está, e o gesto de colocá-lo numa coluna (move ou cria — decide o servidor).
 */

export interface KanbanDoContato {
  id: string;
  name: string;
  is_default: boolean;
  stages: Array<{ id: string; name: string; color: string | null; is_won: boolean; is_lost: boolean }>;
}

export interface NegocioDoContato {
  id: string;
  title: string;
  pipeline_id: string;
  stage_id: string;
  status: string;
  updated_at: string;
}

export interface ResultadoNaColuna {
  acao: "criado" | "movido" | "ja_estava";
  lead_id: string;
  pipeline_id: string;
  stage_id: string;
  tags_da_coluna: string[];
}

export const chaveDosKanbansDoContato = (contactId: string | null) =>
  ["kanbans-do-contato", contactId] as const;

export function useKanbansDoContato(contactId: string | null) {
  return useQuery({
    queryKey: chaveDosKanbansDoContato(contactId),
    queryFn: async () =>
      (
        await apiClient.get<{ data: { kanbans: KanbanDoContato[]; negocios: NegocioDoContato[] } }>(
          `/api/v1/contacts/${encodeURIComponent(contactId!)}/kanbans`,
        )
      ).data,
    enabled: !!contactId,
    staleTime: 15_000,
  });
}

export function useColocarNaColuna(contactId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (stageId: string) =>
      (
        await apiClient.post<{ data: ResultadoNaColuna }>(
          `/api/v1/contacts/${encodeURIComponent(contactId!)}/kanbans`,
          { stage_id: stageId },
        )
      ).data,
    onSettled: (r) => {
      void qc.invalidateQueries({ queryKey: chaveDosKanbansDoContato(contactId) });
      // A coluna pode ter dado tags ao contato, e o quadro daquele Kanban mudou.
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      if (r) void qc.invalidateQueries({ queryKey: ["board", r.pipeline_id] });
    },
  });
}
