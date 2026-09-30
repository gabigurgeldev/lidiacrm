/**
 * GET /api/v1/ai/providers/[provider]/models/search — a busca AO VIVO na
 * OpenRouter que o seletor de modelo usa para achar o modelo lançado hoje.
 *
 * Não grava nada; marca `no_catalogo` para a tela não oferecer "adicionar" o
 * que já está na lista.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { ModeloDaOpenRouter } from "@/lib/ai/catalogo/openrouter";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(), resolveActiveOrg: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const buscarDaOpenRouter = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/cron/sync-model-catalog/route", () => ({ buscarDaOpenRouter }));

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { esquecerCatalogoDaOrigem } from "@/lib/ai/catalogo/origem-em-cache";

const ORG = "22222222-2222-4222-8222-222222222222";

const origem: ModeloDaOpenRouter[] = [
  { id: "moonshotai/kimi-k3", name: "MoonshotAI: Kimi K3", supported_parameters: ["tools"] },
  { id: "moonshotai/kimi-k2", name: "MoonshotAI: Kimi K2", supported_parameters: ["tools"] },
  { id: "openai/gpt-5", name: "OpenAI: GPT-5" },
];

/** Dublê do `ai_models` que registra quais ids a rota perguntou. */
function supabaseCom(jaNoCatalogo: string[]) {
  const perguntados: string[][] = [];
  const cadeia = {
    select: () => cadeia,
    eq: () => cadeia,
    is: () => cadeia,
    in: (_col: string, ids: string[]) => {
      perguntados.push(ids);
      return Promise.resolve({
        data: ids.filter((id) => jaNoCatalogo.includes(id)).map((model_id) => ({ model_id })),
        error: null,
      });
    },
  };
  vi.mocked(createClient).mockResolvedValue({ from: () => cadeia } as never);
  return perguntados;
}

function logado() {
  vi.mocked(loadAuthUser).mockResolvedValue({ id: "u" } as never);
  vi.mocked(resolveActiveOrg).mockResolvedValue({ orgId: ORG, name: "X", role: "manager" });
}

async function chamar(provider: string, q: string) {
  const { GET } = await import("@/app/api/v1/ai/providers/[provider]/models/search/route");
  const req = new NextRequest(
    `https://crm.exemplo/api/v1/ai/providers/${provider}/models/search?q=${encodeURIComponent(q)}`,
  );
  return GET(req, { params: Promise.resolve({ provider }) });
}

describe("GET /api/v1/ai/providers/[provider]/models/search", () => {
  beforeEach(() => {
    esquecerCatalogoDaOrigem();
    vi.mocked(loadAuthUser).mockReset();
    vi.mocked(resolveActiveOrg).mockReset();
    vi.mocked(createClient).mockReset();
    buscarDaOpenRouter.mockReset().mockResolvedValue(origem);
  });

  it("sem sessão é 401 e não vai à origem", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(null);
    const res = await chamar("openrouter", "kimi");
    expect(res.status).toBe(401);
    expect(buscarDaOpenRouter).not.toHaveBeenCalled();
  });

  it("⭐ Anthropic não tem origem para buscar — 422", async () => {
    logado();
    const res = await chamar("anthropic", "claude");
    expect(res.status).toBe(422);
    expect(buscarDaOpenRouter).not.toHaveBeenCalled();
  });

  it("termo vazio é 422", async () => {
    logado();
    const res = await chamar("openrouter", "  ");
    expect(res.status).toBe(422);
  });

  it("⭐ devolve o que casa e marca o que já está no catálogo", async () => {
    logado();
    const perguntados = supabaseCom(["moonshotai/kimi-k2"]);

    const res = await chamar("openrouter", "kimi");
    const corpo = (await res.json()) as {
      data: { models: { model_id: string; no_catalogo: boolean }[] };
    };

    expect(res.status).toBe(200);
    expect(corpo.data.models.map((m) => [m.model_id, m.no_catalogo])).toEqual([
      ["moonshotai/kimi-k3", false],
      ["moonshotai/kimi-k2", true],
    ]);
    expect(perguntados).toEqual([["moonshotai/kimi-k3", "moonshotai/kimi-k2"]]);
  });

  it("origem fora do ar é 502", async () => {
    logado();
    buscarDaOpenRouter.mockRejectedValue(new Error("catalogo_origem_status_503"));
    const res = await chamar("openrouter", "kimi");
    expect(res.status).toBe(502);
  });
});
