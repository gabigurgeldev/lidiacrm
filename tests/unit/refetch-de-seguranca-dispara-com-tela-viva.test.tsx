/**
 * A RECHECAGEM DISPARA MESMO COM A TELA REDESENHANDO.
 *
 * O defeito, relatado: "se o cliente manda mensagem pelo QR, demora muito pra
 * chegar no CRM ou nem aparece ao vivo quando o chat tá aberto".
 *
 * `useRefetchDeSeguranca` é a rede de proteção para quando o realtime fica mudo
 * — ele relê a conversa a cada N segundos. Mas `verificar` dependia do
 * `queryKey`, e quem chama monta a chave como array literal: identidade nova a
 * cada render. O intervalo reiniciava a cada redesenho, e o inbox redesenha a
 * cada 30s — antes dos 45s do timer. A rede NUNCA disparava com o chat aberto.
 *
 * O teste redesenha com chave NOVA (mesmo conteúdo) de 10 em 10 segundos, que é
 * exatamente o que a tela faz, e cobra o refetch no prazo.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRefetchDeSeguranca } from "@/hooks/realtime/useRefetchDeSeguranca";

describe("refetch de segurança com a tela viva", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("redesenhar com chave nova a cada 10s não adia a rechecagem de 15s", async () => {
    const qc = new QueryClient();
    const refetch = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const ultimaEntrega = { current: null };

    const { rerender } = renderHook(
      ({ tick }: { tick: number }) =>
        useRefetchDeSeguranca({
          // Array literal: identidade nova a cada render, como nos chamadores.
          queryKey: ["messages", "conv-1"],
          assinatura: () => `s${tick}`,
          ultimaEntrega,
          intervaloMs: 15_000,
        }),
      { wrapper, initialProps: { tick: 0 } },
    );

    for (let t = 1; t <= 3; t++) {
      await act(async () => {
        vi.advanceTimersByTime(10_000);
      });
      rerender({ tick: t });
    }

    // 30s de tela redesenhando: o timer de 15s tem de ter disparado.
    expect(refetch).toHaveBeenCalled();
    expect(refetch.mock.calls[0]?.[0]).toMatchObject({
      queryKey: ["messages", "conv-1"],
      exact: true,
    });
  });
});
