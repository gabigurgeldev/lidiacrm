import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/v1/ai/agents/construtor/entrevistar
 *
 *  - quem não é admin não chega ao modelo;
 *  - quem encerra é o SERVIDOR: a 3ª rodada ainda pergunta; depois dela,
 *    um modelo que insiste em perguntar recebe "pronto" de volta;
 *  - "pronto" cedo demais (sem o essencial coberto) é pedido de novo;
 *  - resposta sem pergunta válida, duas vezes, vira rodada de RESERVA — nunca
 *    502 (a pessoa presa) nem "pronto" em silêncio (a pergunta pulada);
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
      resultado({ kind: "perguntar", perguntas: [{ pergunta: "Atende convênio?", opcoes: ["Sim", "Não"] }], cobertura: [] }),
    );
    const corpo = await (await chamar({ material: MATERIAL, rodada: 1 })).json();
    expect(corpo.data).toMatchObject({ kind: "perguntar", nicho: "clinica", perguntas: [{ pergunta: "Atende convênio?" }] });
  });

  it("a TERCEIRA rodada ainda pergunta (era forçada a encerrar e só cabiam duas)", async () => {
    objeto.mockResolvedValue(resultado({ kind: "perguntar", perguntas: [{ pergunta: "Mais uma?", resposta_livre: true }] }));
    const corpo = await (await chamar({ material: MATERIAL, rodada: 3 })).json();
    expect(corpo.data).toMatchObject({ kind: "perguntar", rodada: 3, max_rodadas: 3 });
  });

  it("depois da última rodada o servidor encerra, mesmo que o modelo queira perguntar", async () => {
    objeto.mockResolvedValue(resultado({ kind: "perguntar", perguntas: [{ pergunta: "Mais uma?", resposta_livre: true }] }));
    const corpo = await (await chamar({ material: MATERIAL, rodada: 4 })).json();
    expect(corpo.data.kind).toBe("pronto");
    expect(objeto).toHaveBeenCalledTimes(1);
  });

  it("`pronto` na rodada 1 sem o checklist coberto é pedido de novo, e a correção diz o que falta", async () => {
    objeto
      .mockResolvedValueOnce(resultado({ kind: "pronto", resumo: "Agente da clínica.", perguntas: [], cobertura: [] }))
      .mockResolvedValueOnce(
        resultado({ kind: "perguntar", perguntas: [{ pergunta: "Pode dizer preço?", opcoes: ["Sim", "Não"] }], cobertura: [] }),
      );
    const corpo = await (await chamar({ material: MATERIAL })).json();
    expect(corpo.data).toMatchObject({ kind: "perguntar", perguntas: [{ pergunta: "Pode dizer preço?" }] });
    expect(objeto).toHaveBeenCalledTimes(2);
    expect(objeto.mock.calls[1]![0].system).toMatch(/CORREÇÃO: você respondeu kind=.pronto./);
  });

  it("resposta sem pergunta, duas vezes, vira rodada de RESERVA do checklist — nem 502, nem pronto", async () => {
    // Em produção (2026-10-10) o modelo devolveu três vezes "sem pergunta
    // válida". Era 502 (pessoa presa); depois virou `pronto` (pergunta pulada).
    objeto.mockResolvedValue(resultado({ kind: "perguntar", perguntas: [], cobertura: [] }));
    const res = await chamar({ material: MATERIAL });
    expect(res.status).toBe(200);
    const corpo = await res.json();
    expect(corpo.data.kind).toBe("perguntar");
    expect(corpo.data.perguntas.length).toBeGreaterThan(0);
    expect(corpo.data.perguntas[0].pergunta.endsWith("?")).toBe(true);
    expect(objeto).toHaveBeenCalledTimes(2);
  });

  it("`pronto` com o checklist inteiro coberto é aceito de primeira", async () => {
    const cobertura = ["Negócio", "Objetivo do agente", "Oferta", "Pagamento e políticas", "Cliente e qualificação", "Tom", "Passar para uma pessoa"].map(
      (assunto) => ({ assunto, estado: "coberto", evidencia: "está no texto" }),
    );
    objeto.mockResolvedValue(resultado({ kind: "pronto", resumo: "Agente da clínica.", perguntas: [], cobertura }));
    const corpo = await (await chamar({ material: MATERIAL })).json();
    expect(corpo.data).toMatchObject({ kind: "pronto", resumo: "Agente da clínica." });
    expect(objeto).toHaveBeenCalledTimes(1);
  });

  it("o nicho da rodada anterior vale, em vez de reclassificar pelo texto", async () => {
    objeto.mockResolvedValue(resultado({ kind: "perguntar", perguntas: [{ pergunta: "X?", resposta_livre: true }] }));
    const corpo = await (await chamar({ material: MATERIAL, nicho: "loja" })).json();
    expect(corpo.data.nicho).toBe("loja");
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
