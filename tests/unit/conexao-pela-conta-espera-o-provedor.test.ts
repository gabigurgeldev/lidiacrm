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

  it("o servidor espera mais que o provedor leva (medido ~33s)", () => {
    expect(TIMEOUT_DA_GESTAO_MS).toBeGreaterThanOrEqual(45_000);
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
