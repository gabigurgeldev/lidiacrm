"use client";
import { useCallback, useEffect, useRef } from "react";

/**
 * Janela padrão: curta o bastante para a tela parecer instantânea, longa o
 * bastante para engolir a rajada que UMA mensagem recebida produz.
 */
export const JANELA_DE_AGRUPAMENTO_MS = 600;

/**
 * JUNTA N EVENTOS DO CANAL NUMA SÓ INVALIDAÇÃO.
 *
 * Uma mensagem recebida não é um evento: é o INSERT em `messages`, o UPDATE da
 * conversa (`last_message_at`, contagem de não lidas), o ack e às vezes a
 * mídia persistida logo depois. Cada um chegava como `invalidateQueries`, e
 * cada invalidação é a lista de conversas inteira relida do servidor — 3 a 5
 * leituras por mensagem, vezes cada aba aberta, numa VPS de 2 vCPU que já
 * estava com a CPU saturada.
 *
 * O primeiro evento abre a janela; os seguintes só entram nela; quando ela
 * fecha, `invalidar` roda UMA vez. Não é um debounce que reinicia a cada
 * evento: numa org movimentada o fluxo nunca para, e um debounce que reinicia
 * nunca dispararia — a tela congelaria justamente onde há mais acontecendo.
 *
 * `invalidar` vive numa ref pelo mesmo motivo de `useRealtimeChannel`: quem
 * chama passa uma função nova a cada render, e o callback devolvido precisa
 * ser estável para não re-assinar o canal.
 */
export function useInvalidacaoAgrupada(
  invalidar: () => void,
  janelaMs: number = JANELA_DE_AGRUPAMENTO_MS,
): () => void {
  const invalidarRef = useRef(invalidar);
  useEffect(() => {
    invalidarRef.current = invalidar;
  }, [invalidar]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Desmontou com a janela aberta: o timer não pode disparar contra um
  // QueryClient de uma tela que já saiu.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );

  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      invalidarRef.current();
    }, janelaMs);
  }, [janelaMs]);
}
