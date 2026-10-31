"use client";

import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

/** O tipo na forma que o painel de marcar usa — a mesma que `app/app/agenda/page.tsx` monta no RSC. */
export interface TipoParaMarcar {
  id: string;
  nome: string;
  duracaoMin: number;
  donoId: string | null;
  localKind: string | null;
  localDetalhes: string | null;
  profissionaisNecessarios: 1 | 2;
  /** Profissionais habilitadas. Vazio = o tipo ainda não usa habilitação (vale o dono padrão). */
  habilitadas: string[];
}

interface TipoDaRota {
  id: string;
  name: string;
  duration_minutes: number;
  default_owner_user_id: string | null;
  location_kind: string | null;
  location_details: string | null;
  professionals_required: number | null;
  is_active: boolean;
  professional_ids?: string[];
}

/**
 * Os tipos de agendamento ATIVOS, para quem marca fora da tela da Agenda (o
 * inbox). A Agenda os lê no RSC; aqui não há RSC, então vai pela rota — que
 * tem piso `viewer` e já devolve as habilitações por tipo.
 */
export function useTiposDeAgendamento(habilitado = true) {
  return useQuery({
    queryKey: ["agenda", "tipos"],
    enabled: habilitado,
    staleTime: 60_000,
    queryFn: async (): Promise<TipoParaMarcar[]> => {
      const r = await apiClient.get<{ data: TipoDaRota[] }>("/api/v1/agenda/tipos");
      const lista = (r as unknown as { data?: TipoDaRota[] }).data ?? (r as unknown as TipoDaRota[]);
      return (lista ?? [])
        .filter((t) => t.is_active)
        .map((t) => ({
          id: t.id,
          nome: t.name,
          duracaoMin: t.duration_minutes,
          donoId: t.default_owner_user_id ?? null,
          localKind: t.location_kind ?? null,
          localDetalhes: t.location_details ?? null,
          profissionaisNecessarios: t.professionals_required === 2 ? 2 : 1,
          habilitadas: t.professional_ids ?? [],
        }));
    },
  });
}
