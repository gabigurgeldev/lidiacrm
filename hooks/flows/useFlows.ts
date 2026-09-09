"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ErroDeGrafo, FlowGraph } from "@/lib/flow-engine/graph-schema";

const ROTA = "/api/v1/flows";
const doFluxo = (id: string) => `${ROTA}/${encodeURIComponent(id)}`;

export interface FluxoDaLista {
  id: string;
  name: string;
  folder: string | null;
  status: "draft" | "active" | "paused";
  active_version_id: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface VersaoPublicada {
  id: string;
  version_number: number;
  graph: FlowGraph;
  published_at: string;
}

export interface FluxoCompleto extends FluxoDaLista {
  draft_graph: FlowGraph | null;
  versao_publicada: VersaoPublicada | null;
}

export const CHAVE_DOS_FLUXOS = ["flows"] as const;

export function useFluxos() {
  return useQuery({
    queryKey: CHAVE_DOS_FLUXOS,
    queryFn: () => apiClient.get<{ data: FluxoDaLista[] }>(ROTA).then((r) => r.data),
  });
}

export function useFluxo(id: string) {
  return useQuery({
    queryKey: [...CHAVE_DOS_FLUXOS, id],
    queryFn: () => apiClient.get<{ data: FluxoCompleto }>(doFluxo(id)).then((r) => r.data),
  });
}

export function useCriarFluxo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiClient.post<{ data: FluxoDaLista }>(ROTA, { name }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_FLUXOS });
    },
  });
}

export function useSalvarRascunho(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft_graph: FlowGraph) =>
      apiClient.patch<{ data: FluxoCompleto }>(doFluxo(id), { draft_graph }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...CHAVE_DOS_FLUXOS, id] });
    },
  });
}

export interface RespostaDePublicacao {
  versao: { id: string; version_number: number; published_at: string };
  avisos: ErroDeGrafo[];
}

export function usePublicarFluxo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient
        .post<{ data: RespostaDePublicacao }>(`${doFluxo(id)}/publish`, {})
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_FLUXOS });
    },
  });
}

export function useTrocarEstado(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: "active" | "paused") =>
      apiClient.post<{ data: FluxoDaLista }>(`${doFluxo(id)}/state`, { status }).then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_FLUXOS });
    },
  });
}

export function useRenomearFluxo(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiClient.patch<{ data: FluxoDaLista }>(doFluxo(id), { name }).then((r) => r.data),
    // Invalida o PREFIXO: `CHAVE_DOS_FLUXOS` é `["flows"]` e o detalhe é
    // `["flows", id]`, então a lista e o cabeçalho do editor trocam de nome
    // juntos — inclusive num editor aberto noutra aba.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_FLUXOS });
    },
  });
}

export function useApagarFluxo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<unknown>(doFluxo(id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_FLUXOS });
    },
  });
}

/** Um fluxo que o botão "Ativar fluxo" da conversa pode disparar. */
export interface FluxoManual {
  id: string;
  name: string;
}

/**
 * Os fluxos LIGADOS de gatilho manual — a lista do seletor "Ativar fluxo".
 *
 * Sob a CONVERSA (`/api/v1/conversations/[id]/fluxos-manuais`), papel `agent`:
 * é o seletor de uma ação de atendimento, não a tela de autoria de fluxo (que
 * é manager+, em `/api/v1/flows`). Ver o invariante `flows-rbac-alinhado`.
 */
export function useFluxosManuais(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: [...CHAVE_DOS_FLUXOS, "manuais", conversationId] as const,
    enabled: enabled && !!conversationId,
    queryFn: () =>
      apiClient
        .get<{ data: FluxoManual[] }>(
          `/api/v1/conversations/${encodeURIComponent(conversationId)}/fluxos-manuais`,
        )
        .then((r) => r.data),
  });
}

/** Dispara um fluxo manual para o contato DESTA conversa (o botão do cabeçalho). */
export function useAtivarFluxoManual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { conversationId: string; flow_id: string }) =>
      apiClient
        .post<{
          data: { execucao: { id: string; status: string }; ja_estava_rodando: boolean };
        }>(`/api/v1/conversations/${encodeURIComponent(input.conversationId)}/ativar-fluxo`, {
          flow_id: input.flow_id,
        })
        .then((r) => r.data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["flow-executions"] });
    },
  });
}
