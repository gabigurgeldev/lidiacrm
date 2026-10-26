"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { TagDoCatalogo } from "@/lib/tags/tipos";

/**
 * O catálogo de tags (migration 0248) — a mesma leitura para a página de Tags,
 * o seletor do inbox e o menu da coluna do Kanban. Uma chave só (`["tags"]`):
 * criar uma tag na página aparece no seletor do inbox sem recarregar.
 */

export type { TagDoCatalogo };

const ROTA = "/api/v1/tags";
export const CHAVE_DAS_TAGS = ["tags"] as const;

export function useTags(opts: { comUso?: boolean; incluirArquivadas?: boolean } = {}) {
  const qs = new URLSearchParams();
  if (opts.comUso) qs.set("uso", "1");
  if (opts.incluirArquivadas) qs.set("arquivadas", "1");
  const sufixo = qs.toString() ? `?${qs}` : "";
  return useQuery({
    queryKey: [...CHAVE_DAS_TAGS, opts.comUso ?? false, opts.incluirArquivadas ?? false],
    queryFn: async () => (await apiClient.get<{ data: TagDoCatalogo[] }>(`${ROTA}${sufixo}`)).data,
    staleTime: 30_000,
  });
}

function useInvalidar() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: CHAVE_DAS_TAGS });
}

export interface NovaTag {
  name: string;
  color?: string;
  description?: string | null;
}

export function useCriarTag() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: (nova: NovaTag) => apiClient.post<{ data: TagDoCatalogo }>(ROTA, nova),
    onSettled: invalidar,
  });
}

export interface PatchDeTag {
  name?: string;
  color?: string;
  description?: string | null;
  is_archived?: boolean;
  fundir?: boolean;
}

export function useEditarTag() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: PatchDeTag }) =>
      apiClient.patch<{ data: { id: string; fundida_em?: string } }>(
        `${ROTA}/${encodeURIComponent(id)}`,
        patch,
      ),
    onSettled: invalidar,
  });
}

/** Define as tags de uma coluna do Kanban. */
export function useTagsDaColuna() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({
      pipelineId,
      stageId,
      tagIds,
      mover,
    }: {
      pipelineId: string;
      stageId: string;
      tagIds: string[];
      mover?: boolean;
    }) =>
      apiClient.put<{ data: { tag_ids: string[] } }>(
        `/api/v1/pipelines/${encodeURIComponent(pipelineId)}/stages/${encodeURIComponent(stageId)}/tags`,
        { tag_ids: tagIds, ...(mover ? { mover: true } : {}) },
      ),
    onSettled: invalidar,
  });
}

/** As colunas da tag (uma por Kanban), pelo lado da tag — a página de Tags. */
export function useColunasDaTag() {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: ({ tagId, stageIds }: { tagId: string; stageIds: string[] }) =>
      apiClient.put<{ data: { stage_ids: string[] } }>(
        `${ROTA}/${encodeURIComponent(tagId)}/colunas`,
        { stage_ids: stageIds },
      ),
    onSettled: invalidar,
  });
}
