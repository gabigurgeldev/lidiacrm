import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DecisaoRecusadaError,
  URL_DE_DECISOES,
  escolherComModeloDeDecisao,
  limparCacheDeModelosDeDecisao,
  listarModelosDeDecisao,
  pareceModeloDeDecisao,
} from "./openrouter";

// A resposta REAL de produção (2026-10-10), mensagem da tia que faleceu.
const RESPOSTA_REAL = {
  model: "openai/gpt-6-luna-decisions-20261006",
  answers: {
    destino: {
      type: "choice",
      choice: "coroa",
      probabilities: { faby_ai: 0.03, coroa: 0.97, paisagismo: 0 },
      confidence: 0.96,
    },
  },
  usage: { input_tokens: 232, output_tokens: 0, cost: 0.0000232 },
  id: "gen-dec-1",
  provider: "OpenAI",
};

const pergunta = {
  instrucoes: "Quem conduz?",
  opcoes: { faby_ai: "atendimento", coroa: "luto", paisagismo: "jardim" },
};

function fetchQueResponde(status: number, corpo: unknown) {
  return vi.fn(async () => new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status }));
}

afterEach(() => limparCacheDeModelosDeDecisao());

describe("escolherComModeloDeDecisao", () => {
  it("manda state + pergunta de escolha e lê a probabilidade da opção escolhida", async () => {
    const f = fetchQueResponde(200, RESPOSTA_REAL);
    const r = await escolherComModeloDeDecisao({
      apiKey: "k",
      modelo: "openai/gpt-6-luna-decisions",
      state: { mensagem_nova_do_cliente: "minha tia faleceu" },
      pergunta,
      fetchImpl: f as never,
    });
    expect(r).toMatchObject({ escolha: "coroa", confianca: 0.97, custoUsd: 0.0000232, tokensEntrada: 232 });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_DE_DECISOES);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const corpo = JSON.parse(String(init.body));
    expect(corpo).toMatchObject({
      model: "openai/gpt-6-luna-decisions",
      questions: { destino: { type: "choice", instructions: "Quem conduz?", criteria: pergunta.opcoes } },
    });
  });

  it("erro do provedor vira DecisaoRecusadaError com a mensagem dele", async () => {
    const f = fetchQueResponde(402, { error: { message: "Insufficient credits" } });
    await expect(
      escolherComModeloDeDecisao({ apiKey: "k", modelo: "m", state: {}, pergunta, fetchImpl: f as never }),
    ).rejects.toThrow(/402.*Insufficient credits/);
  });

  it("escolha fora das opções é recusada — nunca rota para chave inventada", async () => {
    const f = fetchQueResponde(200, { ...RESPOSTA_REAL, answers: { destino: { type: "choice", choice: "vendas" } } });
    await expect(
      escolherComModeloDeDecisao({ apiKey: "k", modelo: "m", state: {}, pergunta, fetchImpl: f as never }),
    ).rejects.toBeInstanceOf(DecisaoRecusadaError);
  });
});

describe("quais modelos são de decisão", () => {
  // Os 19 da lista ao vivo em 2026-10-10.
  const LISTA = [
    "microsoft/microsoft-decision-1", "nace-ai/drex-v1.5", "cloudflare/clef-omni", "upstage/solar-decide-flash",
    "perplexity/pplx-decider-v1.1-27b", "openai/gpt-6-luna-decisions", "liquid/d1", "cloudflare/clef-flash",
    "cloudflare/clef", "togethercomputer/tev1-4b-experimental", "inception/mercury-decide",
    "inception/mercury-decide:free", "upstage/solar-decide", "respan/span-01", "respan/span-01-lite",
    "respan/span-01-lite:free", "jaredpalmer/kev-4b", "~typesafe/jev-latest", "typesafe/jev-1.13",
  ];

  it("a rede pelo nome reconhece todos os 19 e nenhum modelo de chat", () => {
    expect(LISTA.filter((id) => !pareceModeloDeDecisao(id))).toEqual([]);
    for (const chat of ["openai/gpt-6-luna", "anthropic/claude-haiku-5.5", "openrouter/auto", "typesafe/jev-router"]) {
      expect(pareceModeloDeDecisao(chat)).toBe(false);
    }
  });

  it("a lista ao vivo é lida uma vez e fica em memória", async () => {
    const f = fetchQueResponde(200, { data: LISTA.map((id) => ({ id })) });
    const a = await listarModelosDeDecisao("k", f as never);
    const b = await listarModelosDeDecisao("k", f as never);
    expect(a.has("openai/gpt-6-luna-decisions")).toBe(true);
    expect(b.size).toBe(19);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
