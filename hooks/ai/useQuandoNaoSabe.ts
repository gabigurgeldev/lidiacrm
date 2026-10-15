"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ModoSemFonte } from "@/lib/schemas/settings";

/**
 * O que o agente faz quando o material da empresa não responde — escolha da
 * ORGANIZAÇÃO, não de um agente. `escolha: null` = ninguém escolheu, e vale o
 * que a equipe configurada decide (`resolverModoSemFonte`).
 */
export interface AjustesQuandoNaoSabe {
  escolha: ModoSemFonte | null;
  equipe_configurada: number;
  conferencia_ligada: boolean;
  pode_desligar_conferencia: boolean;
}

interface Resposta {
  data: AjustesQuandoNaoSabe;
}

const CHAVE = ["ai", "quando-nao-sabe"] as const;

export function useQuandoNaoSabe() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await apiClient.get<Resposta>("/api/v1/ai/quando-nao-sabe")).data,
  });
}

export function useSalvarQuandoNaoSabe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { fallback_sem_fonte?: ModoSemFonte | null; grounding_gate?: boolean }) =>
      apiClient.patch("/api/v1/ai/quando-nao-sabe", v),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE }),
  });
}
