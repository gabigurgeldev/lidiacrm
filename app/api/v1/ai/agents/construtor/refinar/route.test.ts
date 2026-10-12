import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/v1/ai/agents/construtor/refinar
 *
 *  - quem não é admin não chega ao modelo; orçamento esgotado é 402 antes de gastar;
 *  - o pedido vai ao modelo como DADO, delimitado, junto com a prévia atual;
 *  - a prévia volta mesclada (o que a pessoa decidiu fica) e conferida;
 *  - falha do modelo é 502 com a prévia da tela intacta (a rota não escreve nada).
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
const FLUXO = "11111111-1111-4111-8111-111111111111";

const PREVIA = {
  nome: "Bia",
  descricao: "Atende a clínica",
  system_prompt: "Quem você é: a Bia, da Clínica Sorriso.",
  pacotes: ["atender"],
  handoff_keywords: ["atendente"],
  materiais: [{ tipo: "documento", nome: "Política de troca", texto: "Troca em 7 dias." }],
  lacunas: [],
  coordenacao: { incluir: false, quando_usar: "Clínica", exemplos: [], nao_usar: [], fluxos_chamaveis: [FLUXO] },
};

function chamar(corpo: unknown) {
  return POST(
    new NextRequest("http://x/api/v1/ai/agents/construtor/refinar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
  );
}

function resultado(o: unknown) {
  return { ok: true, objeto: o, avisos: [], tokensEntrada: 1, tokensSaida: 1, modeloUsado: "m", usouReserva: false };
}

const SAIDA = {
  explicacao: "Deixei o tom mais formal.",
  agente: {
    nome: "Bia",
    descricao: "Atende a clínica",
    system_prompt: "Quem você é: a Bia, assistente da Clínica Sorriso. Tom formal.",
    pacotes: ["atender"],
    handoff_keywords: ["atendente"],
    lacunas: [],
    coordenacao: { quando_usar: "Dúvidas da clínica", exemplos: [], nao_usar: [] },
  },
  materiais_novos: [],
  materiais_remover: [],
};

beforeEach(() => {
  objeto.mockReset();
  vi.mocked(requireRole).mockResolvedValue({ ok: true, org: { orgId: "org-1" }, user: { id: "u" } } as never);
  vi.mocked(orcamentoPermite).mockResolvedValue({ permitido: true } as never);
});

describe("refinar", () => {
  it("quem não é admin não chega ao modelo", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    const res = await chamar({ material: MATERIAL, previa: PREVIA, pedido: "deixe mais formal" });
    expect(res.status).toBe(403);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("orçamento esgotado: 402 antes de gastar", async () => {
    vi.mocked(orcamentoPermite).mockResolvedValue({ permitido: false, motivo: "acabou" } as never);
    const res = await chamar({ material: MATERIAL, previa: PREVIA, pedido: "deixe mais formal" });
    expect(res.status).toBe(402);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("pedido vazio ou prévia inválida: 422", async () => {
    expect((await chamar({ material: MATERIAL, previa: PREVIA, pedido: "" })).status).toBe(422);
    expect((await chamar({ material: MATERIAL, previa: { nome: "x" }, pedido: "mais formal" })).status).toBe(422);
  });

  it("devolve a prévia ajustada, mesclada e conferida; o pedido vai delimitado", async () => {
    objeto.mockResolvedValue(resultado(SAIDA));
    const res = await chamar({ material: MATERIAL, previa: PREVIA, pedido: "deixe mais formal" });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { previa: typeof PREVIA; explicacao: string; verificacao: unknown[] };
    };
    expect(data.previa.system_prompt).toContain("Tom formal");
    expect(data.previa.materiais.map((m) => m.nome)).toEqual(["Política de troca"]);
    expect(data.previa.coordenacao).toMatchObject({ incluir: false, fluxos_chamaveis: [FLUXO] });
    expect(data.explicacao).toBe("Deixei o tom mais formal.");
    expect(Array.isArray(data.verificacao)).toBe(true);

    const { prompt } = objeto.mock.calls[0]![0] as { prompt: string };
    expect(prompt).toContain("PRÉVIA ATUAL:");
    expect(prompt).toMatch(/PEDIDO DO DONO[^\n]*\n<<<\ndeixe mais formal\n>>>/);
  });

  it("modelo falhou: 502", async () => {
    objeto.mockResolvedValue({ ok: false, causa: "timeout" });
    const res = await chamar({ material: MATERIAL, previa: PREVIA, pedido: "deixe mais formal" });
    expect(res.status).toBe(502);
  });
});
