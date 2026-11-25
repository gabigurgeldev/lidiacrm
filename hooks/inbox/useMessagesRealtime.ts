"use client";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useInvalidacaoAgrupada } from "@/hooks/realtime/useInvalidacaoAgrupada";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";
import {
  INTERVALO_DO_INBOX_COM_CANAL_ASSINADO_MS,
  useRefetchDeSeguranca,
} from "@/hooks/realtime/useRefetchDeSeguranca";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { Message } from "@/lib/types/messaging";

interface MessagesResponse {
  data: Message[];
  meta?: { cursor?: string | null; has_more?: boolean };
}

export function useMessagesRealtime(conversationId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["messages", conversationId] as const;

  const query = useInfiniteQuery({
    queryKey,
    enabled: !!conversationId,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) => {
      if (!conversationId) {
        return { data: [], meta: { has_more: false, cursor: null } } as MessagesResponse;
      }
      const qs = new URLSearchParams();
      if (pageParam) qs.set("cursor", pageParam);
      qs.set("limit", "50");
      try {
        return await apiClient.get<MessagesResponse>(
          `/api/v1/conversations/${conversationId}/messages?${qs.toString()}`,
        );
      } catch (err) {
        showApiError(err);
        throw err;
      }
    },
    getNextPageParam: (last) =>
      last.meta?.has_more && last.meta.cursor ? last.meta.cursor : undefined,
    /**
     * Voltar para a aba RESSINCRONIZA — aqui, e não no padrão global.
     *
     * O padrão do repo é `refetchOnWindowFocus: false`, e está certo para o
     * resto: recarregar tudo a cada troca de aba é gasto sem retorno numa tela
     * que muda devagar. O inbox é o oposto — é a tela em que a informação chega
     * de fora enquanto ninguém olha, e voltar para ela é exatamente o momento
     * em que a defasagem aparece.
     *
     * É a segunda rede, não a primeira: quem entrega é o Realtime. Esta existe
     * para o intervalo em que ele esteve caído — e foi o sintoma relatado,
     * "às vezes preciso atualizar para a mensagem aparecer".
     */
    refetchOnWindowFocus: true,
  });

  // Agrupado: INSERT, ack e mídia persistida da mesma mensagem chegam em
  // rajada, e cada um relia o hilo E a lista — ver `useInvalidacaoAgrupada`.
  const onChange = useInvalidacaoAgrupada(
    useCallback(() => {
      if (conversationId) qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      qc.invalidateQueries({ queryKey: ["conversations"] });
    }, [qc, conversationId]),
  );

  const { status: realtimeStatus, ultimaEntrega } = useRealtimeChannel({
    name: conversationId ? `messages-${conversationId}` : "messages-disabled",
    postgresChanges: conversationId
      ? {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        }
      : undefined,
    onChange,
    enabled: !!conversationId,
  });

  /**
   * A REDE DE SEGURANÇA da conversa aberta.
   *
   * A mesma razão da lista, e aqui o custo de ficar velho é maior: a pessoa
   * está OLHANDO a conversa enquanto responde. Com o canal morto e a aba em
   * foco, a resposta do cliente não aparecia até o F5.
   *
   * A assinatura é a contagem de mensagens mais o id da mais recente — a
   * contagem sozinha não flagraria uma mensagem que chega e outra que sai da
   * primeira página no mesmo intervalo.
   */
  const seguranca = useRefetchDeSeguranca<{ pages: MessagesResponse[] }>({
    queryKey,
    assinatura: (d) => {
      const msgs = d?.pages.flatMap((p) => p.data) ?? [];
      return `${msgs.length}:${msgs[0]?.id ?? ""}`;
    },
    ultimaEntrega,
    // 15s e não os 45s do padrão: com a conversa ABERTA a pessoa está esperando
    // a resposta do cliente, e 45s de tela parada lê como "a mensagem não
    // chegou". Uma consulta leve (uma página) por conversa aberta.
    intervaloMs: 15_000,
    // Os 15s valem para o canal CAÍDO. Assinado, quem entrega é o Realtime e a
    // conferência cai para 1 min (5 min nas outras telas): no Inbox, canal
    // assinado e mudo é mensagem que o celular mostra e o CRM não.
    statusDoCanal: realtimeStatus,
    intervaloComCanalAssinadoMs: INTERVALO_DO_INBOX_COM_CANAL_ASSINADO_MS,
    enabled: !!conversationId,
  });

  return { ...query, realtimeStatus, seguranca };
}
