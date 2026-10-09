import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/v1/ai/agents/construtor/entrevistar
 *
 *  - quem não é admin não chega ao modelo;
 *  - o teto de rodadas é do SERVIDOR: na última, um modelo que insiste em
 *    perguntar recebe "pronto" de volta mesmo assim;
 *  - resposta sem pergunta válida e sem resumo é 502, não uma tela vazia;
 *  - orçamento esgotado é 402 antes de gastar.
 */

const objeto = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/flow-engine/ai/budget-gate", () => ({ orcamentoPermite: vi.fn() }));
vi.mock("@/lib/flow-engine/ai/modelo-com-fallback", () => ({
  resolverCadeia: vi.fn(async () => ({ primario: { modelId: "m", origem: "padrao" }, reserva: null })),
  portaComFallback: vi.fn(() => ({ objeto })),
  causaDe: (e: unknown) => String(e),
}));

import { requireRole } from "@/lib/auth/require-role";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";

import { POST } from "./route";

const MATERIAL = "Somos a Clínica Sorriso, em Curitiba. Atendemos de segunda a sábado, das 8h às 18h.";

function chamar(corpo: unknown) {
  return POST(
    new NextRequest("http://x/api/v1/ai/agents/construtor/entrevistar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

function resultado(o: unknown) {
  return { ok: true, objeto: o, avisos: [], tokensEntrada: 1, tokensSaida: 1, modeloUsado: "m", usouReserva: false };
}

beforeEach(() => {
  objeto.mockReset();
  vi.mocked(requireRole).mockResolvedValue({ ok: true, org: { orgId: "org-1" }, user: { id: "u" } } as never);
  vi.mocked(orcamentoPermite).mockResolvedValue({ permitido: true } as never);
});

describe("entrevistar", () => {
  it("quem não é admin não chega ao modelo", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const res = await chamar({ material: MATERIAL });
    expect(res.status).toBe(403);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("devolve a rodada de perguntas", async () => {
    objeto.mockResolvedValue(
      resultado({ kind: "perguntar", perguntas: [{ pergunta: "Atende convênio?", opcoes: ["Sim", "Não"] }] }),
    );
    const corpo = await (await chamar({ material: MATERIAL, rodada: 1 })).json();
    expect(corpo.data).toMatchObject({ kind: "perguntar", nicho: "clinica", perguntas: [{ pergunta: "Atende convênio?" }] });
  });

  it("na última rodada o servidor encerra, mesmo que o modelo queira perguntar", async () => {
    objeto.mockResolvedValue(resultado({ kind: "perguntar", perguntas: [{ pergunta: "Mais uma?", resposta_livre: true }] }));
    const corpo = await (await chamar({ material: MATERIAL, rodada: 3 })).json();
    expect(corpo.data.kind).toBe("pronto");
  });

  it("resposta incoerente é 502", async () => {
    objeto.mockResolvedValue(resultado({ kind: "perguntar", perguntas: [] }));
    expect((await chamar({ material: MATERIAL })).status).toBe(502);
  });

  it("orçamento esgotado é 402, sem chamar o modelo", async () => {
    vi.mocked(orcamentoPermite).mockResolvedValue({ permitido: false, motivo: "acabou" } as never);
    expect((await chamar({ material: MATERIAL })).status).toBe(402);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("material curto demais é 422", async () => {
    expect((await chamar({ material: "oi" })).status).toBe(422);
  });
});
