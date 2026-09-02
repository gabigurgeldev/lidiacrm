"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

/**
 * UM canal oficial. A rota devolve uma LISTA deles desde que conectar um segundo
 * número deixou de sobrescrever o primeiro — ver o cabeçalho de
 * `app/api/v1/channels/official/route.ts`.
 */
export interface OfficialChannel {
  id: string;
  /** Existe token gravado? O token em si NUNCA volta — ver a rota. */
  hasToken: boolean;
  phoneNumberId: string | null;
  wabaId: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  status: string | null;
  /**
   * O que colar na Meta PARA ESTE NÚMERO. Não é global: o `webhook_path_token`
   * é por linha, e é ele que diz à plataforma em qual canal entregar.
   */
  webhook: {
    callbackUrl: string;
    verifyToken: string | null;
    fields: string[];
  };
}

export interface ConnectInput {
  phone_number_id: string;
  waba_id: string;
  token: string;
  /** Apelido do operador. Sem ele, dois números da mesma conta ficam iguais. */
  display_name?: string;
}

export function useOfficialChannels() {
  const q = useQuery({
    queryKey: ["official-channel"],
    queryFn: async () =>
      apiClient.get<{ data: { channels: OfficialChannel[] } }>("/api/v1/channels/official"),
    staleTime: 15_000,
  });
  return {
    canais: q.data?.data.channels ?? [],
    isPending: q.isPending,
    isError: q.isError,
  };
}

export function useConnectOfficialChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConnectInput) =>
      apiClient.post<{ data: { connected: boolean; displayName: string; phoneNumber: string | null } }>(
        "/api/v1/channels/official",
        input,
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["official-channel"] });
      // A lista geral de canais também mudou: o número novo precisa aparecer no
      // seletor do inbox e no sinal de saúde sem exigir F5.
      qc.invalidateQueries({ queryKey: ["channel-sessions"] });
    },
  });
}

export function useRenameOfficialChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; display_name: string }) =>
      apiClient.patch<{ data: { id: string; display_name: string } }>(
        `/api/v1/channels/official/${input.id}`,
        { display_name: input.display_name },
      ),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["official-channel"] });
      qc.invalidateQueries({ queryKey: ["channel-sessions"] });
    },
  });
}
