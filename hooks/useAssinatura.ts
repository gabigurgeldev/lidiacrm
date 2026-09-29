"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { EstadoDeAcesso } from "@/lib/billing/acesso";
import type { ResultadoDoCheckout } from "@/lib/billing/checkout";
import type { CheckoutInput } from "@/lib/billing/validacao";

export interface CobrancaResumo {
  asaas_payment_id: string;
  valor_centavos: number;
  metodo: string | null;
  status: string;
  vencimento: string | null;
  pago_em: string | null;
  url_fatura: string | null;
}

export interface StatusDaAssinatura {
  cobranca_ligada: boolean;
  pode_pagar: boolean;
  estado: EstadoDeAcesso;
  assinatura: {
    status: string;
    isenta: boolean;
    trial_termina_em: string | null;
    pago_ate: string | null;
    metodo: "PIX" | "CREDIT_CARD" | null;
    cartao_final: string | null;
    cartao_bandeira: string | null;
    valor_centavos: number;
    tem_assinatura_no_asaas: boolean;
    cancelada_em: string | null;
  } | null;
  em_aberto: CobrancaResumo | null;
  cobrancas: CobrancaResumo[];
}

export const CHAVE_DA_ASSINATURA = ["billing", "status"] as const;

/** `intervaloMs` > 0 liga o polling — usado enquanto a tela espera o PIX cair. */
export function useStatusDaAssinatura(intervaloMs = 0) {
  return useQuery({
    queryKey: CHAVE_DA_ASSINATURA,
    queryFn: async () => (await apiClient.get<{ data: StatusDaAssinatura }>("/api/v1/billing/status")).data,
    refetchInterval: intervaloMs > 0 ? intervaloMs : false,
    staleTime: 5_000,
  });
}

export function useCheckout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CheckoutInput) =>
      (
        await apiClient.post<{ data: ResultadoDoCheckout }>("/api/v1/billing/checkout", input, {
          // UMA tentativa, 60s: repetir um checkout é criar assinatura em dobro
          // ou cobrar o cartão duas vezes. E o Asaas pode demorar no cartão.
          semRepetir: true,
          timeoutMs: 60_000,
        })
      ).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE_DA_ASSINATURA }),
  });
}

export function useCancelarAssinatura() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.post("/api/v1/billing/cancelar", { confirmar: true }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CHAVE_DA_ASSINATURA }),
  });
}

export const STATUS_PAGOS_NA_TELA = new Set(["CONFIRMED", "RECEIVED", "RECEIVED_IN_CASH"]);
