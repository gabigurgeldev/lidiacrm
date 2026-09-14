"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/**
 * Os marcadores já usados na organização — sugestão para marcar, desmarcar e
 * perguntar "tem o marcador X".
 *
 * Leitura por rota de servidor (e não pelo client de browser) pelo mesmo motivo
 * de `useConversationTagVocabulary`: o cookie de sessão é HttpOnly, então o
 * Supabase do browser não autentica.
 *
 * `staleTime` alto de propósito: a lista muda quando alguém marca alguém, e
 * refazê-la a cada foco de janela seria varrer duas tabelas para um campo de
 * sugestão.
 */
export function useMarcadores() {
  return useQuery({
    queryKey: ["flow-marcadores"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const res = await apiClient.get<{ data: string[] }>("/api/v1/flows/marcadores");
      return res.data;
    },
  });
}
