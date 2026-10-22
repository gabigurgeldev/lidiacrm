"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

/**
 * Uma FOLGA — a exceção de data de uma profissional
 * (`calendar_availability_exceptions` por `professional_id`, migration 0245).
 *
 * Dois sentidos, e o campo `indisponivel` decide qual: `true` tira horas da
 * jornada (férias, consulta médica), `false` ACRESCENTA (um sábado de mutirão).
 * Sem `inicio_minuto`/`fim_minuto`, vale o dia inteiro.
 */
export interface Folga {
  id: string;
  /** `YYYY-MM-DD`, no fuso da jornada dela. */
  data: string;
  indisponivel: boolean;
  /** Minutos desde a meia-noite; ambos nulos = o dia inteiro. */
  inicio_minuto: number | null;
  fim_minuto: number | null;
  motivo: string | null;
}

export type NovaFolga = Omit<Folga, "id">;

function chave(profissionalId: string | null) {
  return ["agenda", "folgas", profissionalId] as const;
}

export function useFolgas(profissionalId: string | null) {
  return useQuery({
    queryKey: chave(profissionalId),
    enabled: profissionalId !== null,
    queryFn: async (): Promise<Folga[]> => {
      try {
        const r = await apiClient.get<{ data: Folga[] }>(
          `/api/v1/agenda/profissionais/${profissionalId}/folgas`,
        );
        return ((r as unknown as { data?: Folga[] }).data ?? (r as unknown as Folga[])) ?? [];
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
  });
}

/**
 * Lançar e remover — e as duas invalidam também os HORÁRIOS LIVRES: uma folga
 * nova tira da oferta o dia que até agora aparecia livre, e é exatamente isso que
 * quem lançou espera ver ao voltar para a Agenda.
 */
export function useLancarFolga(profissionalId: string) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (folga: NovaFolga) =>
      apiClient.post(`/api/v1/agenda/profissionais/${profissionalId}/folgas`, folga),
    onSuccess: () => {
      toast.success(t("Folga lançada. Os horários dela já não são oferecidos nessa data."));
      void qc.invalidateQueries({ queryKey: chave(profissionalId) });
      void qc.invalidateQueries({ queryKey: ["agenda", "horarios-livres"] });
    },
    onError: (err) => showApiError(err),
  });
}

export function useRemoverFolga(profissionalId: string) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: async (folgaId: string) =>
      apiClient.delete(`/api/v1/agenda/profissionais/${profissionalId}/folgas`, { id: folgaId }),
    onSuccess: () => {
      toast.success(t("Folga removida."));
      void qc.invalidateQueries({ queryKey: chave(profissionalId) });
      void qc.invalidateQueries({ queryKey: ["agenda", "horarios-livres"] });
    },
    onError: (err) => showApiError(err),
  });
}
