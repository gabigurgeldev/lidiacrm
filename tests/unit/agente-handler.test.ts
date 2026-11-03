import { describe, expect, it, vi } from "vitest";

import type { EscopoDoAgente } from "@/agente/escopo";
import {
  corpoDoPedido,
  ModeloIndisponivel,
  type PedidoAoModelo,
  type RespostaDoModelo,
} from "@/agente/openrouter.server";
import type { MensagemGravada, RegistroDoAgente } from "@/agente/registro.server";
import {
  corpoDaPergunta,
  diaDoLimite,
  FERRAMENTAS_POR_PERGUNTA,
  FERRAMENTAS_POR_RODADA,
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

/**
 * `usadas` = quantas o dia já tinha ANTES desta pergunta. A reserva imita
 * `fn_agente_reservar_pergunta`: devolve usadas+1, ou `null` no limite.
 */
function registroFalso(
  opts: { usadas?: number; conversaValida?: string | null; historico?: MensagemGravada[] } = {},
) {
  let usadas = opts.usadas ?? 0;
  const r = {
    usadasNoDia: vi.fn(async () => usadas),
    reservarPergunta: vi.fn(async (_u: string, _d: string, limite: number) =>
      usadas >= limite ? null : ++usadas,
    ),
    conversaValida: vi.fn(async () => opts.conversaValida ?? null),
    abrirConversa: vi.fn(async () => CONVERSA),
    historico: vi.fn(async () => opts.historico ?? []),
    ultimaConversa: vi.fn(async () => null),
    gravarPergunta: vi.fn(async () => {}),
    gravarResposta: vi.fn(async () => {}),
    limparHistorico: vi.fn(async () => 0),
  } satisfies RegistroDoAgente;
  return r;
}

function pedeFerramentas(...chamadas: Array<[string, string]>): RespostaDoModelo {
  return {
    texto: null,
    chamadas: chamadas.map(([name, args], i) => ({
      id: `c${i}`,
      type: "function" as const,
      function: { name, arguments: args },
    })),
    tokensIn: 1,
    tokensOut: 1,
    custoUsd: null,
  };
}

const RESPOSTA_TEXTO: RespostaDoModelo = {
  texto: "Pronto.",
  chamadas: [],
  tokensIn: 10,
  tokensOut: 5,
  custoUsd: 0.001,
};
const PEDE_FERRAMENTA: RespostaDoModelo = {
  texto: null,
  chamadas: [
    { id: "c1", type: "function", function: { name: "status_conexoes", arguments: "{}" } },
  ],
  tokensIn: 10,
  tokensOut: 5,
  custoUsd: 0.001,
};

function deps(
  registro: RegistroDoAgente,
  respostas: RespostaDoModelo[],
  extra: Partial<DepsDaPergunta> = {},
) {
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
    contexto: {
      primeiroNome: "Ana",
      papel: "agent",
      organizacao: "Empresa A",
      agoraLocal: "hoje",
      idioma: "pt-BR",
    },
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

  it("rajada: 3 perguntas simultâneas com 49 usadas — só UMA passa (a reserva é atômica)", async () => {
    const registro = registroFalso({ usadas: 49 });
    const rodadas = await Promise.all(
      [1, 2, 3].map(() =>
        responderPergunta(ESCOPO, { mensagem: "oi" }, deps(registro, [RESPOSTA_TEXTO]).d),
      ),
    );
    expect(rodadas.filter((r) => r.tipo === "respondida")).toHaveLength(1);
    expect(rodadas.filter((r) => r.tipo === "limite_atingido")).toHaveLength(2);
    expect(registro.gravarPergunta).toHaveBeenCalledTimes(1);
  });

  it("a 50ª passa, e o contador volta 50", async () => {
    const registro = registroFalso({ usadas: 49 });
    const { d } = deps(registro, [RESPOSTA_TEXTO]);
    const r = await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    expect(r).toMatchObject({ tipo: "respondida", usadas_hoje: 50, limite: 50 });
  });

  it("reserva no dia de São Paulo, por usuário da sessão, e devolve o contador REAL da reserva", async () => {
    const registro = registroFalso({ usadas: 7 });
    const { d } = deps(registro, [RESPOSTA_TEXTO]);
    const r = await responderPergunta(ESCOPO, { mensagem: "oi" }, d);
    expect(registro.reservarPergunta).toHaveBeenCalledWith(USER, "2026-11-03", 50);
    expect(r).toMatchObject({ usadas_hoje: 8 });
    // 02:30 UTC do dia 4 ainda é 23:30 do dia 3 em São Paulo.
    expect(diaDoLimite(new Date("2026-11-04T02:30:00.000Z"))).toBe("2026-11-03");
    expect(diaDoLimite(new Date("2026-11-04T03:00:00.000Z"))).toBe("2026-11-04");
  });
});

describe("assistente · entrada", () => {
  it("pergunta acima de 2000 caracteres é rejeitada pelo schema", () => {
    expect(
      corpoDaPergunta.safeParse({ mensagem: "a".repeat(TAMANHO_MAXIMO_DA_PERGUNTA) }).success,
    ).toBe(true);
    expect(
      corpoDaPergunta.safeParse({ mensagem: "a".repeat(TAMANHO_MAXIMO_DA_PERGUNTA + 1) }).success,
    ).toBe(false);
    expect(corpoDaPergunta.safeParse({ mensagem: "   " }).success).toBe(false);
  });

  it("chaves de escopo no corpo são descartadas (não existem no schema)", () => {
    const r = corpoDaPergunta.parse({
      mensagem: "oi",
      organization_id: "x",
      user_id: "y",
      historico: [],
    });
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
    expect(executarFerramenta).toHaveBeenCalledWith(
      "status_conexoes",
      "{}",
      expect.any(AbortSignal),
    );
    expect(pedidos[1]!.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: '{"conexoes":[]}',
    });
    expect(r).toMatchObject({
      tipo: "respondida",
      resposta: "Pronto.",
      ferramentas: ["status_conexoes"],
      tokensIn: 20,
    });
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
        new Promise((_, rejeitar) =>
          sinal.addEventListener("abort", () => rejeitar(new Error("abort"))),
        ),
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

describe("assistente · teto de ferramentas e prazo", () => {
  it(`no máximo ${FERRAMENTAS_POR_RODADA} ferramentas por rodada; o excedente recebe erro e não roda`, async () => {
    const registro = registroFalso();
    const seis = pedeFerramentas(
      ...Array.from({ length: 6 }, (_, i) => ["status_conexoes", `{"i":${i}}`] as [string, string]),
    );
    const { d, pedidos, executarFerramenta } = deps(registro, [seis, RESPOSTA_TEXTO]);
    await responderPergunta(ESCOPO, { mensagem: "x" }, d);
    expect(executarFerramenta).toHaveBeenCalledTimes(FERRAMENTAS_POR_RODADA);
    const respostas = pedidos[1]!.messages.filter((m) => m.role === "tool");
    // Todo tool_call recebe resposta — o modelo exige o par.
    expect(respostas).toHaveLength(6);
    expect(respostas.slice(FERRAMENTAS_POR_RODADA).map((m) => m.content)).toEqual([
      '{"erro":"limite de ferramentas"}',
      '{"erro":"limite de ferramentas"}',
    ]);
  });

  it(`no máximo ${FERRAMENTAS_POR_PERGUNTA} ferramentas na pergunta inteira`, async () => {
    const registro = registroFalso();
    const rodada = (n: number) =>
      pedeFerramentas(
        ...Array.from(
          { length: 4 },
          (_, i) => ["status_conexoes", `{"r":${n},"i":${i}}`] as [string, string],
        ),
      );
    const { d, executarFerramenta } = deps(registro, [rodada(1), rodada(2), rodada(3)]);
    const r = await responderPergunta(ESCOPO, { mensagem: "x" }, d);
    expect(executarFerramenta).toHaveBeenCalledTimes(FERRAMENTAS_POR_PERGUNTA);
    expect(r.tipo === "respondida" && r.ferramentas).toHaveLength(FERRAMENTAS_POR_PERGUNTA);
  });

  it("chamada repetida (mesmo nome e argumentos) reaproveita o resultado em vez de consultar de novo", async () => {
    const registro = registroFalso();
    const dupla = pedeFerramentas(["status_conexoes", "{}"], ["status_conexoes", "{}"]);
    const { d, executarFerramenta, pedidos } = deps(registro, [dupla, RESPOSTA_TEXTO]);
    await responderPergunta(ESCOPO, { mensagem: "x" }, d);
    expect(executarFerramenta).toHaveBeenCalledTimes(1);
    expect(pedidos[1]!.messages.filter((m) => m.role === "tool")).toHaveLength(2);
  });

  it("prazo estourado DURANTE a ferramenta: o sinal chega a ela e a próxima nem roda", async () => {
    const registro = registroFalso();
    const sinais: AbortSignal[] = [];
    const lenta = vi.fn(
      (_n: string, _a: string, sinal: AbortSignal) =>
        new Promise<string>((resolver) => {
          sinais.push(sinal);
          sinal.addEventListener("abort", () => resolver('{"erro":"tempo esgotado"}'));
        }),
    );
    const { d } = deps(
      registro,
      [pedeFerramentas(["status_conexoes", "{}"], ["resumo_conta", "{}"])],
      {
        tempoMaximoMs: 10,
        executarFerramenta: lenta,
      },
    );
    const r = await responderPergunta(ESCOPO, { mensagem: "x" }, d);
    expect(lenta).toHaveBeenCalledTimes(1);
    expect(sinais[0]!.aborted).toBe(true);
    expect(r.tipo === "respondida" && r.resposta).toMatch(/demorei/);
    expect(registro.gravarResposta).toHaveBeenCalledTimes(1);
  });

  it("modelo fora do ar: a falha é gravada como resposta antes de o erro subir", async () => {
    const registro = registroFalso();
    const { d } = deps(registro, [], {
      chamarModelo: async () => {
        throw new ModeloIndisponivel("OpenRouter respondeu 502", 502);
      },
    });
    await expect(responderPergunta(ESCOPO, { mensagem: "x" }, d)).rejects.toBeInstanceOf(
      ModeloIndisponivel,
    );
    expect(registro.gravarPergunta).toHaveBeenCalledTimes(1);
    expect(registro.gravarResposta).toHaveBeenCalledWith(
      USER,
      ORG,
      CONVERSA,
      expect.stringMatching(/falhou/),
      expect.any(Object),
    );
  });
});

describe("assistente · dado pessoal na pergunta", () => {
  it("telefone, CPF e e-mail colados na pergunta são mascarados antes de gravar E de ir ao modelo", async () => {
    const registro = registroFalso();
    const { d, pedidos } = deps(registro, [RESPOSTA_TEXTO]);
    await responderPergunta(
      ESCOPO,
      {
        mensagem: "o cliente 11 98765-4321, CPF 123.456.789-09, joana.silva@gmail.com, não recebe",
      },
      d,
    );
    const gravada = (registro.gravarPergunta.mock.calls[0] as unknown[])[3] as string;
    const enviada = pedidos[0]!.messages.at(-1)!.content as string;
    for (const texto of [gravada, enviada]) {
      expect(texto).not.toContain("98765-4321");
      expect(texto).not.toContain("123.456.789");
      expect(texto).not.toContain("joana.silva");
      expect(texto).toContain("•••• 4321");
      expect(texto).toContain("j•••@gmail.com");
    }
  });
});

describe("assistente · OpenRouter", () => {
  it("todo pedido sai com data_collection: deny e com o custo pedido de volta", () => {
    const corpo = corpoDoPedido({
      model: "m",
      messages: [],
      max_tokens: 10,
    } as unknown as PedidoAoModelo);
    expect(corpo.provider).toEqual({ data_collection: "deny" });
    expect(corpo.usage).toEqual({ include: true });
  });
});
