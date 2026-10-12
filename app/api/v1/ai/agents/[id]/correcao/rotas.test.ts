import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * As rotas do "Corrigir com IA" que chamam o modelo.
 *
 *  - quem não é admin não chega ao modelo; agente/conversa que a organização
 *    não tem é 404 ANTES de gastar; orçamento esgotado é 402 antes de gastar;
 *  - o relato vai delimitado, como dado;
 *  - a proposta volta aparada contra a base, com o conteúdo da base para o
 *    teste e a conferência mostrando o preço que a correção inventou.
 */

const objeto = vi.fn();
const contexto = vi.fn();
vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/flow-engine/ai/budget-gate", () => ({ orcamentoPermite: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/ai/agents/correcao/contexto", () => ({ carregarContextoDaCorrecao: (...a: unknown[]) => contexto(...a) }));
vi.mock("@/lib/flow-engine/ai/modelo-com-fallback", () => ({
  resolverCadeia: vi.fn(async () => ({ primario: { modelId: "m", origem: "padrao" }, reserva: null })),
  portaComFallback: vi.fn(() => ({ objeto })),
  causaDe: (e: unknown) => String(e),
}));

import { requireRole } from "@/lib/auth/require-role";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";

import { POST as diagnosticar } from "./diagnosticar/route";
import { POST as propor } from "./propor/route";

const AGENTE = "33333333-3333-4333-8333-333333333333";
const BASE = "55555555-5555-4555-8555-555555555555";
const PROMPT = "Quem você é: a Bia, da Clínica Sorriso. A consulta custa R$ 200.";
const PROBLEMA = "O agente está dando desconto sem autorização.";

function chamar(rota: typeof diagnosticar, corpo: unknown, id = AGENTE) {
  return rota(
    new NextRequest(`http://x/api/v1/ai/agents/${id}/correcao`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }),
    { params: Promise.resolve({ id }) },
  );
}

const resultado = (o: unknown) => ({ ok: true, objeto: o, avisos: [], tokensEntrada: 1, tokensSaida: 1, modeloUsado: "m", usouReserva: false });

const CONTEXTO = {
  ok: true,
  contexto: {
    agente: { id: AGENTE, nome: "Bia", descricao: null },
    base: {
      id: BASE,
      version_number: 3,
      status: "published",
      conteudo: { system_prompt: PROMPT, tool_ids: [] },
      bruta: { system_prompt: PROMPT, tool_ids: [], handoff_keywords: ["atendente"] },
    },
    partiuDoRascunho: false,
    materiais: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: "Tabela", tipo: "faq", amostra: "Limpeza: R$ 150." }],
    execucoes: [],
    conversa: null,
  },
};

const DIAGNOSTICO = { resumo: "A regra do desconto não tem alternativa.", hipoteses: [{ causa: "Regra vaga", evidencia: "Nunca dê desconto.", onde: "prompt" }] };

beforeEach(() => {
  objeto.mockReset();
  contexto.mockReset();
  contexto.mockResolvedValue(CONTEXTO);
  vi.mocked(requireRole).mockResolvedValue({ ok: true, org: { orgId: "org-1" }, user: { id: "u" } } as never);
  vi.mocked(orcamentoPermite).mockResolvedValue({ permitido: true } as never);
});

describe("diagnosticar", () => {
  it("quem não é admin não chega ao modelo", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    expect((await chamar(diagnosticar, { problema: PROBLEMA })).status).toBe(403);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("agente inválido é 400; agente ou conversa que a organização não tem é 404 antes de gastar", async () => {
    expect((await chamar(diagnosticar, { problema: PROBLEMA }, "nao-e-uuid")).status).toBe(400);
    contexto.mockResolvedValue({ ok: false, status: 404, code: "not_found", message: "Conversa não encontrada." });
    expect((await chamar(diagnosticar, { problema: PROBLEMA })).status).toBe(404);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("orçamento esgotado: 402 antes de gastar", async () => {
    vi.mocked(orcamentoPermite).mockResolvedValue({ permitido: false, motivo: "acabou" } as never);
    expect((await chamar(diagnosticar, { problema: PROBLEMA })).status).toBe(402);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("devolve causas e perguntas; o relato vai delimitado e a organização é a da sessão", async () => {
    objeto.mockResolvedValue(resultado({ ...DIAGNOSTICO, perguntas: [{ pergunta: "Pode dar desconto?", opcoes: ["Sim", "Não"] }] }));
    const res = await chamar(diagnosticar, { problema: PROBLEMA });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { diagnostico: { hipoteses: unknown[]; perguntas: unknown[] }; base: { id: string } } };
    expect(data.diagnostico.hipoteses).toHaveLength(1);
    expect(data.diagnostico.perguntas).toHaveLength(1);
    expect(data.base.id).toBe(BASE);
    expect(contexto).toHaveBeenCalledWith(expect.anything(), "org-1", AGENTE, expect.anything());
    const { prompt } = objeto.mock.calls[0]![0] as { prompt: string };
    expect(prompt).toContain(`<<<\n${PROBLEMA}\n>>>`);
  });
});

describe("propor", () => {
  it("devolve a proposta aparada, a base para o teste e o preço inventado na conferência", async () => {
    objeto.mockResolvedValue(
      resultado({
        explicacao: "Reforcei a regra.",
        system_prompt: `${PROMPT}\nNunca dê desconto; se pedirem, ofereça parcelar. O clareamento custa R$ 999.`,
        mudancas_no_prompt: [{ o_que: "Alternativa ao desconto", por_que: "O agente cedia." }],
        materiais_novos: [],
        materiais_desligar: [{ nome: "Tabela", por_que: "Desatualizada." }, { nome: "Inexistente", por_que: "" }],
        pacotes_ligar: [],
        pacotes_desligar: [],
        frases_de_passagem_adicionar: ["atendente", "gerente"],
        frases_de_passagem_remover: [],
        mensagem_de_teste: "Me dá um desconto?",
      }),
    );
    const res = await chamar(propor, { problema: PROBLEMA, diagnostico: DIAGNOSTICO });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: {
        proposta: { base_version_id: string; materiais_desligar: Array<{ valor: string }>; frases_de_passagem_adicionar: string[] };
        base: { versao: unknown };
        verificacao: Array<{ regra: string }>;
      };
    };
    expect(data.proposta.base_version_id).toBe(BASE);
    expect(data.proposta.materiais_desligar.map((m) => m.valor)).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
    expect(data.proposta.frases_de_passagem_adicionar).toEqual(["gerente"]);
    expect(data.base.versao).toMatchObject({ system_prompt: PROMPT });
    expect(data.verificacao.some((a) => a.regra === "fato_inventado")).toBe(true);
  });

  it("sem diagnóstico: 422", async () => {
    expect((await chamar(propor, { problema: PROBLEMA })).status).toBe(422);
    expect(objeto).not.toHaveBeenCalled();
  });

  it("modelo falhou: 502", async () => {
    objeto.mockResolvedValue({ ok: false, causa: "timeout" });
    expect((await chamar(propor, { problema: PROBLEMA, diagnostico: DIAGNOSTICO })).status).toBe(502);
  });
});
