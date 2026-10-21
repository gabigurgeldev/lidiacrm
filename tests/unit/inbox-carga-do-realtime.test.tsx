/**
 * O INBOX PARA DE MARTELAR O SERVIDOR.
 *
 * Produção (VPS de 2 vCPU) com a CPU saturada, e o inbox multiplicando a
 * carga por três caminhos que este arquivo vigia:
 *
 *  1. cada evento do canal relia a lista inteira — uma mensagem recebida são
 *     3 a 5 eventos, então 3 a 5 leituras, vezes cada aba aberta;
 *  2. o refetch de segurança rodava a 15s/45s com o Realtime saudável e com a
 *     aba em segundo plano;
 *  3. o envio repetia o POST no timeout de 10s, e o servidor já tinha aceitado
 *     o primeiro: mensagem dobrada no WhatsApp do cliente.
 *
 * Os hooks rodam de verdade; o canal e o cliente HTTP são falsificados, para
 * o teste controlar quantos eventos chegam e ler o que saiu.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RealtimeStatus } from "@/hooks/realtime/useRealtimeChannel";

const canal: { onChange: ((p: unknown) => void) | null; status: RealtimeStatus } = {
  onChange: null,
  status: "subscribed",
};

vi.mock("@/hooks/realtime/useRealtimeChannel", () => ({
  useRealtimeChannel: (opts: { onChange: (p: unknown) => void }) => {
    canal.onChange = opts.onChange;
    return { status: canal.status, ultimaEntrega: { current: null } };
  },
}));

const post = vi.fn(async (..._args: unknown[]) => ({ data: { id: "m-1" } }));
vi.mock("@/lib/api/client", () => ({
  apiClient: {
    get: vi.fn(async () => ({ data: [], meta: { has_more: false, cursor: null } })),
    post: (...args: unknown[]) => post(...args),
  },
}));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));
vi.mock("@/hooks/auth/AuthProvider", () => ({ useUserOpcional: () => null }));

const { useInvalidacaoAgrupada, JANELA_DE_AGRUPAMENTO_MS } = await import(
  "@/hooks/realtime/useInvalidacaoAgrupada"
);
const { useRefetchDeSeguranca, INTERVALO_COM_CANAL_ASSINADO_MS } = await import(
  "@/hooks/realtime/useRefetchDeSeguranca"
);
const { useConversationsRealtime } = await import("@/hooks/inbox/useConversationsRealtime");
const { useMessagesRealtime } = await import("@/hooks/inbox/useMessagesRealtime");
const { useSendMessage } = await import("@/hooks/inbox/useSendMessage");

function montarQc() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
  return { qc, wrapper };
}

function chavesInvalidadas(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
}

describe("invalidações do canal agrupadas numa janela", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    canal.onChange = null;
    canal.status = "subscribed";
  });
  afterEach(() => vi.useRealTimers());

  it("N eventos dentro da janela viram UMA chamada", () => {
    const invalidar = vi.fn();
    const { result } = renderHook(() => useInvalidacaoAgrupada(invalidar));

    for (let i = 0; i < 5; i++) result.current();
    expect(invalidar, "nada roda antes de a janela fechar").not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS);
    });
    expect(invalidar).toHaveBeenCalledTimes(1);
  });

  it("fluxo contínuo de eventos não adia para sempre — dispara a cada janela", () => {
    // Um debounce que reiniciasse a cada evento nunca dispararia numa org
    // movimentada: a tela congelaria onde há mais acontecendo.
    const invalidar = vi.fn();
    const { result } = renderHook(() => useInvalidacaoAgrupada(invalidar));

    for (let t = 0; t < 3_000; t += 100) {
      result.current();
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(invalidar.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(invalidar.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("desmontar com a janela aberta cancela o timer", () => {
    const invalidar = vi.fn();
    const { result, unmount } = renderHook(() => useInvalidacaoAgrupada(invalidar));

    result.current();
    unmount();
    act(() => {
      vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS * 2);
    });
    expect(invalidar).not.toHaveBeenCalled();
  });

  it("lista de conversas: rajada de 5 eventos = 1 invalidação de ['conversations']", () => {
    const { qc, wrapper } = montarQc();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useConversationsRealtime({}, "org-1"), { wrapper });

    expect(canal.onChange, "o hook precisa ter assinado o canal").toBeTruthy();
    for (let i = 0; i < 5; i++) canal.onChange!({ i });
    act(() => {
      vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS);
    });

    expect(chavesInvalidadas(invalidate)).toEqual(['["conversations"]']);
  });

  it("conversa aberta: rajada de 4 eventos = 1 releitura do hilo e 1 da lista", () => {
    const { qc, wrapper } = montarQc();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    renderHook(() => useMessagesRealtime("conv-1"), { wrapper });

    for (let i = 0; i < 4; i++) canal.onChange!({ i });
    act(() => {
      vi.advanceTimersByTime(JANELA_DE_AGRUPAMENTO_MS);
    });

    expect(chavesInvalidadas(invalidate).sort()).toEqual(
      ['["conversations"]', '["messages","conv-1"]'].sort(),
    );
  });
});

describe("refetch de segurança só aperta quando o canal caiu", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function montar(status: RealtimeStatus | undefined) {
    const { qc, wrapper } = montarQc();
    const refetch = vi.spyOn(qc, "refetchQueries").mockResolvedValue(undefined);
    renderHook(
      () =>
        useRefetchDeSeguranca({
          queryKey: ["messages", "conv-1"],
          assinatura: () => "x",
          ultimaEntrega: { current: null },
          intervaloMs: 15_000,
          statusDoCanal: status,
        }),
      { wrapper },
    );
    return refetch;
  }

  it("canal assinado: nenhuma conferência nos 15s de antes, nem em 4 minutos", async () => {
    const refetch = montar("subscribed");
    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("canal assinado: o detector segue vivo, mas a 5 min", async () => {
    // `subscribed` descreve a assinatura, não a entrega: desligar de vez
    // cegaria o detector no estado em que só ele enxerga a perda.
    const refetch = montar("subscribed");
    await act(async () => {
      vi.advanceTimersByTime(INTERVALO_COM_CANAL_ASSINADO_MS);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it.each<RealtimeStatus>(["channel_error", "timed_out", "closed", "connecting"])(
    "canal %s: confere no intervalo curto",
    async (status) => {
      const refetch = montar(status);
      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(refetch).toHaveBeenCalledTimes(1);
    },
  );

  it("sem status informado: o comportamento de antes (board, linha do tempo)", async () => {
    const refetch = montar(undefined);
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("aba em segundo plano não confere, mesmo com o canal caído", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const refetch = montar("channel_error");
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refetch).not.toHaveBeenCalled();
  });
});

describe("envio de mensagem não repete o POST", () => {
  it("useSendMessage pede semRepetir ao cliente HTTP", async () => {
    post.mockClear();
    const { wrapper } = montarQc();
    const { result } = renderHook(() => useSendMessage(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ conversation_id: "conv-1", body: "oi" });
    });

    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe("/api/v1/messages");
    expect(post.mock.calls[0]?.[2]).toMatchObject({ semRepetir: true });
  });
});
