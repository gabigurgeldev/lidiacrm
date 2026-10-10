import { afterEach, describe, expect, it, vi } from "vitest";

import { limparCacheDeModelosDeDecisao } from "@/lib/ai/decisoes/openrouter";

import type { PedidoDeDecisao } from "./contrato";
import { decisorPorLlm } from "./llm";

/**
 * O coordenador com um MODELO DE DECISÃO da OpenRouter escolhido no ponto:
 * a pergunta vai pela API de decisões (state + choice), não pelo chat.
 */

const ORG = "00000000-0000-4000-8000-000000000001";
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

const pedido: PedidoDeDecisao = {
  organizationId: ORG,
  conversationId: "c",
  contactId: null,
  jobId: null,
  mensagem: "minha tia faleceu ontem, preciso de algo bonito pra despedida",
  contexto: ["Atendimento: Oi! Sou a Faby AI. Como posso ajudar?"],
  atual: null,
  candidatos: [
    { chave: "faby_ai", nome: "Faby AI", quando_usar: "atendimento da loja", exemplos: [], nao_usar: [] },
    { chave: "coroa", nome: "Coroa", quando_usar: "luto, velório", exemplos: ["faleceu"], nao_usar: ["coroa de princesa"] },
  ],
  timeoutMs: 5000,
  confiancaMinima: 0.6,
};

function pool(pontos: Record<string, string>) {
  const inserts: unknown[][] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from ai_purpose_bindings")) {
      if (sql.includes("exists")) return { rows: [{ ok: (params[1] as string) in pontos }] };
      const m = pontos[params[1] as string];
      return { rows: m ? [{ provider: "openrouter", model_id: m, credential_id: null }] : [] };
    }
    if (sql.includes("settings->'llm'")) return { rows: [{ llm: {} }] };
    if (sql.includes("from ai_provider_credentials")) return { rows: [] };
    if (sql.includes("insert into llm_calls")) {
      inserts.push(params);
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { db: { query } as never, inserts };
}

function openrouter(respostas: Record<string, unknown>) {
  const corpos: Array<{ model: string; state: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("output_modalities=decisions")) {
        return new Response(JSON.stringify({ data: Object.keys(respostas).map((id) => ({ id })) }), { status: 200 });
      }
      const corpo = JSON.parse(String(init?.body));
      corpos.push(corpo);
      return new Response(JSON.stringify(respostas[corpo.model]), { status: 200 });
    }),
  );
  return corpos;
}

const resposta = (choice: string, p: number) => ({
  model: "x-20261006",
  answers: { destino: { type: "choice", choice, probabilities: { [choice]: p }, confidence: p } },
  usage: { input_tokens: 232, output_tokens: 0, cost: 0.0000232 },
});

const cfg = { openrouterApiKey: "chave-or", cacheTtl: "1h" as const };
const naoChamar = vi.fn(async () => {
  throw new Error("não devia ter ido ao chat");
});

afterEach(() => {
  vi.unstubAllGlobals();
  limparCacheDeModelosDeDecisao();
});

describe("modelo de decisão no ponto do coordenador", () => {
  it("decide pela API de decisões, com o contexto no state, e registra o custo", async () => {
    const corpos = openrouter({ "openai/gpt-6-luna-decisions": resposta("coroa", 0.97) });
    const { db, inserts } = pool({ coordenador_decidir: "openai/gpt-6-luna-decisions" });
    const r = await decisorPorLlm(db, cfg, { log, runModelCall: naoChamar as never }).decidir(pedido);

    expect(r).toMatchObject({ status: "ok", escolha: "coroa", confianca: 0.97, modelo: "openai/gpt-6-luna-decisions" });
    expect(naoChamar).not.toHaveBeenCalled();
    expect(corpos[0]!.state).toMatchObject({
      conversa_recente: ["Atendimento: Oi! Sou a Faby AI. Como posso ajudar?"],
      mensagem_nova_do_cliente: pedido.mensagem,
    });
    await new Promise((res) => setTimeout(res, 0));
    expect(inserts[0]).toEqual(expect.arrayContaining(["coordenador_decidir", "openai/gpt-6-luna-decisions", 232, 0.00232]));
  });

  it("probabilidade baixa no 1º: o segundo ajudante (também de decisão) decide", async () => {
    openrouter({
      "openai/gpt-6-luna-decisions": resposta("faby_ai", 0.41),
      "perplexity/pplx-decider-v1.1-27b": resposta("coroa", 0.9),
    });
    const { db } = pool({
      coordenador_decidir: "openai/gpt-6-luna-decisions",
      coordenador_decidir_reserva: "perplexity/pplx-decider-v1.1-27b",
    });
    const r = await decisorPorLlm(db, cfg, { log, runModelCall: naoChamar as never }).decidir(pedido);
    expect(r).toMatchObject({ escolha: "coroa", modelo: "perplexity/pplx-decider-v1.1-27b" });
    expect(r.ajudante).toMatchObject({ decidiu: true, primeiro: { escolha: "faby_ai", confianca: 0.41 } });
  });
});
