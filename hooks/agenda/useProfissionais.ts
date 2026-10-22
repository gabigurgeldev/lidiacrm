"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import type { ScheduleWindow } from "@/lib/schemas/routing";

/**
 * Uma profissional como `GET /api/v1/agenda/profissionais` a devolve.
 *
 * `jornada_fonte` diz DE ONDE a jornada vem, e a tela precisa saber: quem tem
 * login publica a jornada em `attendant_availability` (a mesma que Equipe ›
 * Atendimento edita), quem não tem guarda a própria em
 * `calendar_professionals.schedule`. Editar pela tela de Profissionais grava no
 * lugar certo dos dois casos — a rota decide, a tela só avisa onde vai parar.
 */
export interface ProfissionalDaApi {
  id: string;
  nome: string;
  trilha: number | null;
  ativo: boolean;
  user_id: string | null;
  jornada: { timezone?: string; windows?: ScheduleWindow[] } | null;
  jornada_fonte: "membro" | "propria";
  /** Os tipos de agendamento (serviços) que ela atende. */
  tipos: string[];
}

export const CHAVE_DOS_PROFISSIONAIS = ["agenda", "profissionais"] as const;

function desembrulhar<T>(r: unknown): T {
  return ((r as { data?: T }).data ?? (r as T)) as T;
}

/** A lista inteira, ativas e desativadas — a tela de configuração mostra as duas. */
export function useProfissionais(inicial?: ProfissionalDaApi[]) {
  return useQuery({
    queryKey: CHAVE_DOS_PROFISSIONAIS,
    ...(inicial ? { initialData: inicial } : {}),
    queryFn: async (): Promise<ProfissionalDaApi[]> => {
      try {
        const r = await apiClient.get<{ data: ProfissionalDaApi[] }>("/api/v1/agenda/profissionais");
        return desembrulhar<ProfissionalDaApi[]>(r) ?? [];
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}

export interface NovaProfissional {
  nome: string;
  trilha?: number | null;
  /** Vincular a um membro da equipe. Depois de vinculada, não se desvincula. */
  user_id?: string | null;
  jornada?: { timezone: string; windows: ScheduleWindow[] } | null;
  tipos?: string[];
}

export type AlteracaoDaProfissional = Partial<Omit<NovaProfissional, "user_id">> & {
  ativo?: boolean;
  /** Só aceito quando ela ainda não tem membro — a rota recusa trocar um vínculo existente. */
  user_id?: string;
};

/**
 * Criar, alterar e desativar — as três invalidam `["agenda"]` inteiro, porque
 * uma profissional nova muda a barra de pessoas, os horários livres e a visão
 * por profissional de uma vez. Invalidar só a lista deixaria a grade oferecendo
 * horário de quem acabou de ser desativada.
 */
export function useSalvarProfissional() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (
      entrada: { id: null; dados: NovaProfissional } | { id: string; dados: AlteracaoDaProfissional },
    ) =>
      entrada.id === null
        ? apiClient.post<{ data: ProfissionalDaApi }>("/api/v1/agenda/profissionais", entrada.dados)
        : apiClient.patch<{ data: ProfissionalDaApi }>(
            `/api/v1/agenda/profissionais/${entrada.id}`,
            entrada.dados,
          ),
    onSuccess: (_r, entrada) => {
      toast.success(entrada.id === null ? t("Profissional cadastrada.") : t("Alterações salvas."));
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
    onError: (err) => showApiError(err),
  });
}

/**
 * DESATIVAR, não apagar — a rota grava `is_active = false`. O histórico de quem
 * atendeu cada agendamento aponta para ela (`on delete no action`), e apagar
 * levaria junto a resposta a "quem fez este atendimento?".
 */
export function useDesativarProfissional() {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (id: string) => apiClient.delete(`/api/v1/agenda/profissionais/${id}`),
    onSuccess: () => {
      toast.success(t("Profissional desativada — ela sai da agenda e dos horários oferecidos."));
      void qc.invalidateQueries({ queryKey: ["agenda"] });
    },
    onError: (err) => showApiError(err),
  });
}
