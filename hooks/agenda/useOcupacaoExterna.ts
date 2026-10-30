"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

import type { Agendamento } from "@/components/agenda/tipos";

import type { RecorteDaGrade } from "./useAgendamentos";

interface OcupacaoDaRota {
  id: string;
  starts_at: string;
  ends_at: string;
  owner_user_id: string | null;
}

/**
 * Os blocos "Ocupado" do Google no período da grade.
 *
 * Sem este hook, o refetch do `useAgendamentos` substituía a lista inteira e a
 * ocupação que o servidor entregou na primeira pintura sumia. Eles voltam na
 * MESMA forma da página: `origem: "google_sync"`, `titulo: "Ocupado"` — o
 * título do evento nunca atravessa (ver `app/api/v1/agenda/ocupacao-externa`).
 *
 * Falha silenciosa de propósito: a ocupação do Google é informação acessória da
 * grade, e um toast a cada refetch por uma conexão quebrada seria pior que o
 * bloco ausente (o cartão da conexão já avisa quando ela parou).
 */
export function useOcupacaoExterna(recorte: Pick<RecorteDaGrade, "de" | "ate"> | null) {
  return useQuery({
    queryKey: ["agenda", "ocupacao-externa", recorte?.de ?? null, recorte?.ate ?? null],
    enabled: recorte !== null,
    queryFn: async (): Promise<Agendamento[]> => {
      const qs = new URLSearchParams({ de: recorte!.de, ate: recorte!.ate });
      const r = await apiClient.get<{ data: OcupacaoDaRota[] }>(`/api/v1/agenda/ocupacao-externa?${qs.toString()}`);
      const lista = (r as unknown as { data?: OcupacaoDaRota[] }).data ?? (r as unknown as OcupacaoDaRota[]);
      return (lista ?? []).map((e) => ({
        id: e.id,
        titulo: "Ocupado",
        responsavelId: e.owner_user_id ?? "",
        comeca: e.starts_at,
        termina: e.ends_at,
        origem: "google_sync" as const,
        situacao: "confirmed" as const,
      }));
    },
  });
}
