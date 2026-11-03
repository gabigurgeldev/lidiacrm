import { describe, expect, it, vi } from "vitest";

import type { EscopoDoAgente } from "@/agente/escopo";
import type { PedidoAoModelo, RespostaDoModelo } from "@/agente/openrouter.server";
import type { MensagemGravada, RegistroDoAgente } from "@/agente/registro.server";
import {
  corpoDaPergunta,
  inicioDoDiaDoLimite,
  responderPergunta,
  RODADAS,
  TAMANHO_MAXIMO_DA_PERGUNTA,
  type DepsDaPergunta,
} from "@/app/api/v1/agente/_handler";

/**
 * O laço da assistente sem banco e sem rede: limite diário, tamanho da
 * pergunta, histórico vindo do banco (nunca do corpo) e teto de rodadas.
 */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const CONVERSA = "cccccccc-0000-4000-8000-000000000001";
const ESCOPO: EscopoDoAgente = {
  organizationId: ORG,
  userId: USER,
  role: "agent",
  visibilityMode: "own_and_unassigned",
  fuso: "America/Sao_Paulo",
};

function registroFalso(
  opts: { usadas?: number; conversaValida?: string | null; historico?: MensagemGravada[]; perdeuARajada?: boolean } = {},
) {
  const r = {
    contarPerguntas: vi.fn(async () => opts.usadas ?? 0),
    conversaValida: vi.fn(async () => opts.conversaValida ?? null),
    abrirConversa: vi.fn(async () => CONVERSA),
    historico: vi.fn(async () => opts.historico ?? []),
    ultimaConversa: vi.fn(async () => null),
    gravarPergunta: vi.fn(async () => "pergunta-1"),
    dentroDoLimite: vi.fn(async () => !opts.perdeuARajada),
    descartarPergunta: vi.fn(async () => {}),
    gravarResposta: vi.fn(async () => {}),
  } satisfies RegistroDoAgente;
  return r;
}

const RESPOSTA_TEXTO: RespostaDoModelo = { texto: "Pronto.", chamadas: [], tokensIn: 10, tokensOut: 5, custoUsd: 0.001 };
const PEDE_FERRAMENTA: RespostaDoModelo = {
  texto: null,
  chamadas: [{ id: "c1", type: "function", function: { name: "status_conexoes", arguments: "{}" } }],
  tokensIn: 10,
  tokensOut: 5,
  custoUsd: 0.001,
};

function deps(registro: RegistroDoAgente, respostas: RespostaDoModelo[], extra: Partial<DepsDaPergunta> = {}) {
  const pedidos: PedidoAoModelo[] = [];
  const chamarModelo = vi.fn(async (p: PedidoAoModelo) => {
    pedidos.push(structuredClone(p));
    return respostas.shift() ?? RESPOSTA_TEXTO;
  });
  const executarFerramenta = vi.fn(async () => JSON.stringify({ conexoes: [] }));
  const d: DepsDaPergunta = {
    registro,
    chamarModelo,
    executarFerramenta,
    modelo: "anthropic/claude-haiku-5.5",
    limiteDiario: 50,
    identidade: { nomeDoAgente: "Lia", nomeDoProduto: "Marca X" },
    contexto: { primeiroNome: "Ana", papel: "agent", organizacao: "Empresa A", agoraLocal: "hoje", idioma: "pt-BR" },
    agora: new Date("2026-11-03T15:00:00.000Z"),
    ...extra,
  };
  return { d, pedidos, chamarModelo, executarFerramenta };
}

describe("assistente · limite diário", () => {
  it("a 51ª pergunta do dia (50 já feitas) é recusada sem gravar nada e sem chamar o modelo", async () => {
    const registro = registroFalso({ usadas: 50 });
    const { d, chamarModelo } = deps(registro, []);
    const r = await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    expect(r).toEqual({ tipo: "limite_atingido", usadas_hoje: 50, limite: 50 });
    expect(chamarModelo).not.toHaveBeenCalled();
    expect(registro.gravarPergunta).not.toHaveBeenCalled();
    expect(registro.abrirConversa).not.toHaveBeenCalled();
  });

  it("rajada: passou pela contagem, mas outra requisição gravou antes — apaga a própria pergunta e recusa", async () => {
    const registro = registroFalso({ usadas: 49, perdeuARajada: true });
    const { d, chamarModelo } = deps(registro, [RESPOSTA_TEXTO]);
    const r = await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    expect(r).toEqual({ tipo: "limite_atingido", usadas_hoje: 50, limite: 50 });
    expect(registro.dentroDoLimite).toHaveBeenCalledWith(USER, expect.any(Date), "pergunta-1", 50);
    expect(registro.descartarPergunta).toHaveBeenCalledWith(USER, "pergunta-1");
    expect(chamarModelo).not.toHaveBeenCalled();
    expect(registro.gravarResposta).not.toHaveBeenCalled();
  });

  it("a 50ª passa, e o contador volta 50", async () => {
    const registro = registroFalso({ usadas: 49 });
    const { d } = deps(registro, [RESPOSTA_TEXTO]);
    const r = await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    expect(r).toMatchObject({ tipo: "respondida", usadas_hoje: 50, limite: 50 });
  });

  it("conta as perguntas do dia de São Paulo, por usuário da sessão", async () => {
    const registro = registroFalso();
    const { d } = deps(registro, [RESPOSTA_TEXTO]);
    await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    // 15:00 UTC = 12:00 em São Paulo → o dia começou às 03:00 UTC.
    expect(registro.contarPerguntas).toHaveBeenCalledWith(USER, new Date("2026-11-03T03:00:00.000Z"));
    expect(inicioDoDiaDoLimite(new Date("2026-11-04T02:30:00.000Z")).toISOString()).toBe("2026-11-03T03:00:00.000Z");
  });
});

describe("assistente · entrada", () => {
  it("pergunta acima de 2000 caracteres é rejeitada pelo schema", () => {
    expect(corpoDaPergunta.safeParse({ mensagem: "a".repeat(TAMANHO_MAXIMO_DA_PERGUNTA) }).success).toBe(true);
    expect(corpoDaPergunta.safeParse({ mensagem: "a".repeat(TAMANHO_MAXIMO_DA_PERGUNTA + 1) }).success).toBe(false);
    expect(corpoDaPergunta.safeParse({ mensagem: "   " }).success).toBe(false);
  });

  it("chaves de escopo no corpo são descartadas (não existem no schema)", () => {
    const r = corpoDaPergunta.parse({ mensagem: "oi", organization_id: "x", user_id: "y", historico: [] });
    expect(r).toEqual({ mensagem: "oi" });
  });

  it("conversa_id que não é da pessoa abre conversa nova; o histórico vem do banco", async () => {
    const registro = registroFalso({
      conversaValida: null,
      historico: [{ role: "assistant", content: "resposta antiga", created_at: "x" }],
    });
    const { d, pedidos } = deps(registro, [RESPOSTA_TEXTO]);
    const alheia = "dddddddd-0000-4000-8000-000000000009";
    const r = await responderPergunta(ESCOPO, { mensagem: "oi", conversa_id: alheia }, d);
    expect(registro.conversaValida).toHaveBeenCalledWith(USER, ORG, alheia);
    expect(registro.abrirConversa).toHaveBeenCalledWith(USER, ORG);
    expect(r).toMatchObject({ conversa_id: CONVERSA });
    const msgs = pedidos[0]!.messages;
    expect(msgs[0]!.role).toBe("system");
    expect(msgs.slice(1)).toEqual([
      { role: "assistant", content: "resposta antiga" },
      { role: "user", content: "oi" },
    ]);
  });
});

describe("assistente · laço de ferramentas", () => {
  it("executa a ferramenta pedida, devolve o resultado ao modelo e grava só os NOMES", async () => {
    const registro = registroFalso();
    const { d, pedidos, executarFerramenta } = deps(registro, [PEDE_FERRAMENTA, RESPOSTA_TEXTO]);
    const r = await responderPergunta(ESCOPO, { mensagem: "meu zap está conectado?" }, d);
    expect(executarFerramenta).toHaveBeenCalledWith("status_conexoes", "{}");
    expect(pedidos[1]!.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c1", content: '{"conexoes":[]}' });
    expect(r).toMatchObject({ tipo: "respondida", resposta: "Pronto.", ferramentas: ["status_conexoes"], tokensIn: 20 });
    expect(registro.gravarResposta).toHaveBeenCalledWith(USER, ORG, CONVERSA, "Pronto.", {
      tokensIn: 20,
      tokensOut: 10,
      custoUsd: 0.002,
      modelo: "anthropic/claude-haiku-5.5",
      ferramentas: ["status_conexoes"],
    });
  });

  it(`no máximo ${RODADAS} chamadas ao modelo; a última sai com tool_choice "none"`, async () => {
    const registro = registroFalso();
    const sempreFerramenta = Array.from({ length: 10 }, () => PEDE_FERRAMENTA);
    const { d, pedidos } = deps(registro, sempreFerramenta);
    await responderPergunta(ESCOPO, { mensagem: "loop" }, d);
    expect(pedidos).toHaveLength(RODADAS);
    expect(pedidos.map((p) => p.tool_choice)).toEqual(["auto", "auto", "auto", "none"]);
    expect(pedidos.every((p) => p.max_tokens === 1000)).toBe(true);
  });

  it("tempo esgotado vira resposta educada, e a troca é gravada", async () => {
    const registro = registroFalso();
    const { d } = deps(registro, [], {
      tempoMaximoMs: 10,
      chamarModelo: (_p, sinal) =>
        new Promise((_, rejeitar) => sinal.addEventListener("abort", () => rejeitar(new Error("abort")))),
    });
    const r = await responderPergunta(ESCOPO, { mensagem: "demora" }, d);
    expect(r).toMatchObject({ tipo: "respondida" });
    expect(r.tipo === "respondida" && r.resposta).toMatch(/demorei/);
    expect(registro.gravarResposta).toHaveBeenCalled();
  });

  it("o system prompt proíbe ações e leva o manual com cache_control", async () => {
    const registro = registroFalso();
    const { d, pedidos } = deps(registro, [RESPOSTA_TEXTO]);
    await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    const sistema = pedidos[0]!.messages[0]!;
    expect(sistema.role).toBe("system");
    const blocos = sistema.content as Array<{ text: string; cache_control?: unknown }>;
    expect(blocos[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(blocos[0]!.text).toContain("Você é Lia, a assistente de suporte do Marca X");
    expect(blocos[0]!.text).toMatch(/NUNCA executa ações/);
    expect(blocos[0]!.text).toContain("Mapa do menu");
    expect(blocos[1]!.cache_control).toBeUndefined();
    expect(blocos[1]!.text).toContain("Empresa A");
  });
});
