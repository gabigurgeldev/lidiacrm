"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { showApiError } from "@/components/feedback/ApiErrorToast";
import { apiClient } from "@/lib/api/client";

/**
 * Conexão por credencial de CONTA — uma chave, várias instâncias.
 *
 * ⚠️ Nenhum tipo aqui nomeia provider: o rótulo comercial chega do servidor no
 * campo `label`, e `modo` é vocabulário nosso (`oficial` / `qr`). É o que a
 * doutrina `restricao-de-canal` exige de um arquivo fora de `lib/channels/`.
 */
export interface InstanciaDaConta {
  id: string;
  nome: string | null;
  telefone: string | null;
  /** Estado cru do provedor. A tela mostra, não interpreta. */
  situacao: string | null;
  conectada: boolean;
  /** `oficial` = janela de 24h; `qr` = texto livre com risco de banimento. */
  modo: "oficial" | "qr";
  /** Já existe linha ativa desta instância nesta organização. */
  importada: boolean;
}

export interface ConexaoDaConta {
  id: string;
  instanceId: string | null;
  nome: string | null;
  telefone: string | null;
  status: string | null;
  modo: string | null;
}

export function useConexoesDaConta() {
  const q = useQuery({
    queryKey: ["conta-de-instancias"],
    queryFn: async () =>
      apiClient.get<{ data: { label: string; conectados: ConexaoDaConta[] } }>(
        "/api/v1/channels/account",
      ),
    staleTime: 15_000,
  });
  return {
    label: q.data?.data.label ?? null,
    conectados: q.data?.data.conectados ?? [],
    isPending: q.isPending,
  };
}

/**
 * Valida a chave e devolve as instâncias dela. **Não grava nada** — ver o
 * cabeçalho da rota: importar todas seria decidir pelo operador quais números da
 * conta dele pertencem a este CRM.
 */
export function useDescobrirInstancias() {
  return useMutation({
    mutationFn: async (input: { api_key: string }) =>
      apiClient.post<{ data: { label: string; instancias: InstanciaDaConta[] } }>(
        "/api/v1/channels/account",
        input,
      ),
    onError: showApiError,
  });
}

export function useImportarInstancias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { api_key: string; instancias: InstanciaDaConta[] }) =>
      apiClient.post<{
        data: { importadas: Array<{ id: string; nome: string; recebendo: boolean }> };
      }>("/api/v1/channels/account/instances", input),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conta-de-instancias"] });
      // A lista geral de canais mudou: os números novos precisam aparecer no
      // seletor do inbox e no sinal de saúde sem exigir F5.
      qc.invalidateQueries({ queryKey: ["channel-sessions"] });
    },
  });
}
