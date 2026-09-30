/**
 * "CONSULTANDO O PROVEDOR…" TERMINA COM A RESPOSTA DO PROVEDOR.
 *
 * Medido em 2026-09-30: o provedor da conexão pela conta leva 19–33s para
 * responder `GET /v1/instances` — até para recusar uma chave. Havia dois prazos
 * menores que isso na frente dele:
 *
 *   servidor  15s  → abortava antes da resposta, chave certa ou errada;
 *   tela      10s  → desistia antes do SERVIDOR e repetia 3×.
 *
 * O botão girava ~35s e caía em erro. A ordem que tem de valer:
 *
 *   provedor (~30s) < servidor (TIMEOUT_DA_GESTAO_MS) < tela (sem repetir)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { post } = vi.hoisted(() => ({ post: vi.fn(async () => ({ data: {} })) }));
vi.mock("@/lib/api/client", () => ({ apiClient: { post, get: vi.fn() } }));
vi.mock("@/components/feedback/ApiErrorToast", () => ({ showApiError: vi.fn() }));

import { TIMEOUT_DA_GESTAO_MS } from "@/lib/channels/stevo/instancias";
import {
  PRAZO_DA_CONSULTA_MS,
  PRAZO_DA_IMPORTACAO_MS,
} from "@/hooks/channels/useContaDeInstancias";

describe("prazos da conexão pela conta", () => {
  beforeEach(() => post.mockClear());

  it("o servidor espera mais que o provedor leva (pior medido: 87s)", () => {
    expect(TIMEOUT_DA_GESTAO_MS).toBeGreaterThan(87_000);
  });

  it("a tela espera mais que o servidor — senão desiste antes da resposta", () => {
    expect(PRAZO_DA_CONSULTA_MS).toBeGreaterThan(TIMEOUT_DA_GESTAO_MS);
    expect(PRAZO_DA_IMPORTACAO_MS).toBeGreaterThan(TIMEOUT_DA_GESTAO_MS);
  });

  it("a consulta vai com o prazo longo e UMA tentativa", async () => {
    const { useDescobrirInstancias } = await import("@/hooks/channels/useContaDeInstancias");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { renderHook, act } = await import("@testing-library/react");
    const React = await import("react");
    const qc = new QueryClient();
    const { result } = renderHook(() => useDescobrirInstancias(), {
      wrapper: ({ children }) => React.createElement(QueryClientProvider, { client: qc }, children),
    });
    await act(async () => {
      await result.current.mutateAsync({ api_key: "k" });
    });
    expect(post).toHaveBeenCalledWith(
      "/api/v1/channels/account",
      { api_key: "k" },
      {
        timeoutMs: PRAZO_DA_CONSULTA_MS,
        semRepetir: true,
      },
    );
  });
});

/**
 * A frase diz de QUEM é o problema. "Verifique a conexão do servidor" com o
 * provedor devolvendo 503 em 43s mandou o operador investigar uma VPS perfeita.
 */
describe("a frase do erro aponta para o lado certo", () => {
  const consultar = async (fetchFalso: typeof fetch) => {
    const original = globalThis.fetch;
    globalThis.fetch = fetchFalso;
    try {
      const { validarContaStevo } = await import("@/lib/channels/stevo/instancias");
      return await validarContaStevo({ apiKey: "k", baseUrl: "https://provedor.test" });
    } finally {
      globalThis.fetch = original;
    }
  };

  it("provedor que não responde a tempo: 'está lento', não 'sua rede'", async () => {
    const r = await consultar(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.motivo).toMatch(/não respondeu em \d+s/);
  });

  it("503 do provedor: instável, e a chave NÃO foi recusada", async () => {
    const r = await consultar(async () => new Response("{}", { status: 503 }));
    expect(!r.ok && r.motivo).toMatch(/instável agora \(respondeu 503\).*chave não foi recusada/);
  });

  it("controle: erro de rede de verdade continua pedindo para olhar o servidor", async () => {
    const r = await consultar(async () => {
      throw new TypeError("fetch failed");
    });
    expect(!r.ok && r.motivo).toMatch(/verifique a conexão do servidor/);
  });

  it("controle: 401 continua sendo chave recusada", async () => {
    const r = await consultar(async () => new Response("{}", { status: 401 }));
    expect(!r.ok && r.motivo).toMatch(/chave de API recusada/);
  });
});
