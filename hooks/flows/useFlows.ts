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

export function useApagarFluxo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<unknown>(doFluxo(id)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE_DOS_FLUXOS });
    },
  });
}
