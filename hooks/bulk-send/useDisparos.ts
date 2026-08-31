"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";

export interface FraseDePausa {
  titulo: string;
  proximoPasso: string;
  abrirConexoes: boolean;
}

export interface FraseDePulo {
  frase: string;
  proximoPasso: string;
  tentarDeNovo: boolean;
  abrirContato: boolean;
}

export interface DisparoDaLista {
  id: string;
  name: string;
  status: string;
  mode: "freeform" | "template";
  channel_session_id: string;
  interval_ms: number;
  scheduled_for: string | null;
  next_send_at: string | null;
  pause_reason: string | null;
  pause_detail: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  contagens: Record<string, number>;
}

export interface DisparoDetalhado extends DisparoDaLista {
  body: string | null;
  template_name: string | null;
  template_language: string | null;
  fora_por_motivo: Record<string, number>;
  restantes: number;
  previsao_minima_ms: number;
  pausa: FraseDePausa | null;
  motivos: Record<string, FraseDePulo | null>;
}

export interface DestinatarioDaTela {
  id: string;
  contact_id: string;
  nome: string | null;
  telefone: string | null;
  status: string;
  sent_at: string | null;
  message_id: string | null;
  motivo: FraseDePulo | null;
  erro: string | null;
}

/** Estados em que o disparo ainda muda sozinho — a tela precisa reperguntar. */
const EM_MOVIMENTO = new Set(["running", "scheduled"]);

export function useDisparos() {
  return useQuery({
    queryKey: ["bulk-sends"],
    queryFn: async () => apiClient.get<{ data: DisparoDaLista[] }>("/api/v1/bulk-sends"),
    select: (res) => res.data,
    // Enquanto houver campanha andando, a lista se atualiza sozinha. Sem isto o
    // operador ficaria olhando um número parado e recarregando a página.
    refetchInterval: (query) =>
      (query.state.data as { data?: DisparoDaLista[] } | undefined)?.data?.some((d) =>
        EM_MOVIMENTO.has(d.status),
      )
        ? 5_000
        : false,
  });
}

export function useDisparo(id: string) {
  return useQuery({
    queryKey: ["bulk-send", id],
    queryFn: async () => apiClient.get<{ data: DisparoDetalhado }>(`/api/v1/bulk-sends/${id}`),
    select: (res) => res.data,
    refetchInterval: (query) => {
      const d = (query.state.data as { data?: DisparoDetalhado } | undefined)?.data;
      return d && EM_MOVIMENTO.has(d.status) ? 5_000 : false;
    },
  });
}

export function useDestinatarios(id: string, status?: string) {
  return useQuery({
    queryKey: ["bulk-send-recipients", id, status ?? "todos"],
    queryFn: async () =>
      apiClient.get<{ data: DestinatarioDaTela[] }>(
        `/api/v1/bulk-sends/${id}/recipients${status ? `?status=${status}` : ""}`,
      ),
    select: (res) => res.data,
  });
}
