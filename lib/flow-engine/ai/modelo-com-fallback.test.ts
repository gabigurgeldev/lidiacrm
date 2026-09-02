/**
 * A PORTA DO MODELO — e a resposta CORTADA, que era lida como erro de parse.
 *
 * ═══ O defeito que este arquivo existe para não deixar voltar ═══
 *
 * "Criar fluxo com IA" falhava, e a causa que chegava ao log era
 * `No object generated: could not parse the response`. A frase fala de PARSE, e
 * mandou cinco correções seguidas procurarem no schema, no provedor e no
 * transporte. Não estava em nenhum dos três.
 *
 * Medido contra o provedor real (OpenRouter, `anthropic/claude-sonnet-5`):
 *
 *   pedido de exemplo (8 blocos)   826 · 1043 · 1068 · 1096 · 1106 · 1166 tokens
 *   pedido de tamanho normal       4 de 4 rodadas com `finishReason: "length"`,
 *   (15 blocos)                    saída travada em 1200 — o teto que a rota pedia
 *
 * O produto autorizava menos espaço do que a resposta ocupa. Trocar de modelo
 * nunca ajudou, porque o teto é nosso; e o sintoma era INTERMITENTE porque a
 * reserva, mais concisa, às vezes cabia — o que espalhou ainda mais a busca.
 *
 * ═══ O que estes casos medem ═══
 *
 * Que o corte é RECONHECIDO (vira causa que diz "cortada", com o
 * `finishReason` preservado) e que ele é RECUPERADO no mesmo modelo, com mais
 * espaço, ANTES de trocar de modelo — porque trocar de modelo não devolve
 * espaço a ninguém.
 *
 * O que eles NÃO alcançam: se 4000 é o número certo. Nenhum teste offline
 * responde isso, e é por isso que o desenho não depende da resposta — a
 * escalada existe justamente para o número não precisar estar certo.
 */
import { NoObjectGeneratedError, type LanguageModelUsage } from "ai";
import type * as SdkDeIa from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const generateObjectMock = vi.hoisted(() => vi.fn());

vi.mock("ai", async (importOriginal) => {
  const real = await importOriginal<typeof SdkDeIa>();
  return { ...real, generateObject: generateObjectMock };
});

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { FATOR_DE_ESCALADA, TETO_MAXIMO_DE_SAIDA, TETO_SEGURO_DE_SAIDA, portaComFallback } =
  await import("./modelo-com-fallback");
const { logger } = await import("@/lib/logger");

/** Um modelo de mentira — a porta só o repassa ao SDK, que aqui é o mock. */
function modelo(id: string) {
  return { model: id as never, modelId: id, origem: "padrao" as const };
}

const CTX = { organizationId: "org-1", requestId: "req-1", flowId: "flow-1" };

function pedido(maxOutputTokens = 1000) {
  return {
    schema: z.object({ ok: z.boolean() }),
    system: "s",
    prompt: "p",
    maxOutputTokens,
    rotulo: "plano",
  };
}

/** O `usage` na forma que o SDK devolve — o teste só olha `outputTokens`. */
function usoDe(saida: number): LanguageModelUsage {
  return {
    inputTokens: 100,
    outputTokens: saida,
    totalTokens: 100 + saida,
    inputTokenDetails: {},
    outputTokenDetails: {},
  } as LanguageModelUsage;
}

/** O erro EXATO que o SDK lança quando a resposta foi cortada no teto. */
function cortada(tokens: number): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "could not parse the response.",
    text: '{"blo',
    finishReason: "length",
    usage: usoDe(tokens),
    // O SDK exige o envelope da resposta; nada aqui o lê.
    response: { id: "r", timestamp: new Date(0), modelId: "m-1" },
  });
}

/** Cortada por outro motivo: o modelo parou sozinho e falou fora do formato. */
function recusada(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    message: "could not parse the response.",
    text: "Claro! Aqui está o seu fluxo:",
    finishReason: "stop",
    usage: usoDe(12),
    response: { id: "r", timestamp: new Date(0), modelId: "m-1" },
  });
}

function respondeu(objeto: unknown) {
  return {
    object: objeto,
    finishReason: "stop",
    warnings: [],
    usage: usoDe(200),
  };
}

beforeEach(() => {
  generateObjectMock.mockReset();
  vi.mocked(logger.warn).mockClear();
});

describe("a resposta cortada é reconhecida como corte", () => {
  it("a causa DIZ que foi corte — não 'could not parse'", async () => {
    // É a asserção central do arquivo. A frase do SDK fala de parse; quem lê o
    // log precisa ler "cortada", senão vai procurar no schema outra vez.
    generateObjectMock.mockRejectedValue(cortada(1200));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    const r = await porta.objeto(pedido(1200));

    expect(r.ok).toBe(false);
    expect(r.causa).toContain("CORTADA");
    expect(r.causa).toContain("1200 tokens de saída");
    expect(r.causa).not.toContain("could not parse");
  });

  it("`finishReason` sobrevive ao caminho de ERRO", async () => {
    // Sem isto a decisão de escalar não tem como existir: o campo só era
    // preenchido no caminho de sucesso, e o chamador não distinguia "cortada"
    // de "recusada".
    generateObjectMock.mockRejectedValue(cortada(800));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    const r = await porta.objeto(pedido(800));

    expect(r.finishReason).toBe("length");
    expect(r.tokensSaida).toBe(800);
  });

  it("recusa que NÃO é corte não vira mensagem de corte", async () => {
    generateObjectMock.mockRejectedValue(recusada());

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    const r = await porta.objeto(pedido());

    expect(r.causa).not.toContain("CORTADA");
    expect(r.causa).toContain("não devolveu o objeto pedido");
    // O que o modelo disse no lugar do objeto é o dado que resolve o caso.
    expect(r.causa).toContain("Aqui está o seu fluxo");
  });
});

describe("a recuperação é ESPAÇO, no mesmo modelo", () => {
  it("cortada uma vez: repete no MESMO modelo com o teto dobrado", async () => {
    generateObjectMock
      .mockRejectedValueOnce(cortada(1000))
      .mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: modelo("m-2") }, CTX);
    const r = await porta.objeto(pedido(1000));

    expect(r.ok).toBe(true);
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(generateObjectMock.mock.calls[0]![0].maxOutputTokens).toBe(1000);
    expect(generateObjectMock.mock.calls[1]![0].maxOutputTokens).toBe(
      1000 * FATOR_DE_ESCALADA,
    );
    // O MESMO modelo. Trocar de modelo não devolve espaço a ninguém, e foi essa
    // troca que fez a falha parecer intermitente por meses.
    expect(generateObjectMock.mock.calls[1]![0].model).toBe("m-1");
    expect(r.usouReserva).toBe(false);
  });

  it("falha que NÃO é corte vai direto para a reserva, sem escalada", async () => {
    // Escalar aqui seria uma chamada paga a mais por uma causa que espaço não
    // resolve.
    generateObjectMock
      .mockRejectedValueOnce(recusada())
      .mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: modelo("m-2") }, CTX);
    const r = await porta.objeto(pedido(1000));

    expect(r.ok).toBe(true);
    expect(generateObjectMock).toHaveBeenCalledTimes(2);
    expect(generateObjectMock.mock.calls[1]![0].model).toBe("m-2");
    expect(generateObjectMock.mock.calls[1]![0].maxOutputTokens).toBe(1000);
  });

  it("a reserva HERDA o teto maior quando a falha foi corte", async () => {
    // Mandá-la com o teto original repetiria o corte com outro modelo e cobraria
    // por isso.
    generateObjectMock
      .mockRejectedValueOnce(cortada(1000))
      .mockRejectedValueOnce(cortada(2000))
      .mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: modelo("m-2") }, CTX);
    const r = await porta.objeto(pedido(1000));

    expect(r.ok).toBe(true);
    expect(generateObjectMock).toHaveBeenCalledTimes(3);
    expect(generateObjectMock.mock.calls[2]![0].model).toBe("m-2");
    expect(generateObjectMock.mock.calls[2]![0].maxOutputTokens).toBe(2000);
  });

  it("escala UMA vez só — nunca uma escada de chamadas pagas", async () => {
    generateObjectMock.mockRejectedValue(cortada(1000));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    await porta.objeto(pedido(1000));

    expect(generateObjectMock).toHaveBeenCalledTimes(2);
  });

  it("não escala acima do teto máximo — modelo de saída curta recusaria", async () => {
    generateObjectMock.mockRejectedValue(cortada(TETO_MAXIMO_DE_SAIDA));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    await porta.objeto(pedido(TETO_MAXIMO_DE_SAIDA));

    // Já estava no máximo: nada a escalar, e uma chamada a mais seria paga para
    // receber o mesmo corte.
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("cortada DE NOVO com o dobro: a causa final continua sendo a do corte", async () => {
    // É o que permite à rota dizer "o fluxo é grande demais" em vez de "tente de
    // novo" — a única frase acionável quando nem o dobro coube.
    generateObjectMock
      .mockRejectedValueOnce(cortada(1000))
      .mockRejectedValueOnce(cortada(2000));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    const r = await porta.objeto(pedido(1000));

    expect(r.ok).toBe(false);
    expect(r.finishReason).toBe("length");
    expect(r.causa).toContain("2000 tokens de saída");
  });
});

describe("o teto que o ENDPOINT recusa desce, em vez de quebrar", () => {
  /**
   * O erro de um endpoint compatível com OpenAI quando o número pedido passa do
   * que o modelo aceita. Não é `NoObjectGeneratedError`: nada foi gerado, o
   * PARÂMETRO é que foi recusado.
   */
  function tetoAltoDemais(): Error {
    const err = new Error("Provider returned error") as Error & {
      statusCode?: number;
      responseBody?: string;
    };
    err.statusCode = 400;
    err.responseBody = JSON.stringify({
      error: { message: "max_tokens: must be <= 4096", code: 400 },
    });
    return err;
  }

  it("recusado o teto, repete no MESMO modelo com o teto seguro", () => {
    // Medido: 26 dos 419 modelos da OpenRouter declaram saída máxima abaixo do
    // teto normal. Subir o teto para consertar os outros 94% os quebraria — a
    // queda é o que impede que o conserto de uns seja o defeito de outros.
    generateObjectMock
      .mockRejectedValueOnce(tetoAltoDemais())
      .mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-curto"), reserva: null }, CTX);
    return porta.objeto(pedido(6000)).then((r) => {
      expect(r.ok).toBe(true);
      expect(generateObjectMock).toHaveBeenCalledTimes(2);
      expect(generateObjectMock.mock.calls[1]![0].maxOutputTokens).toBe(TETO_SEGURO_DE_SAIDA);
      expect(generateObjectMock.mock.calls[1]![0].model).toBe("m-curto");
    });
  });

  it("depois da queda, a escalada parte do teto EM USO — não do recusado", async () => {
    // Sem isto, um modelo que acabou de recusar 6000 receberia 12000 na
    // escalada: a recuperação pediria de novo, e maior, o número que já foi
    // recusado.
    generateObjectMock
      .mockRejectedValueOnce(tetoAltoDemais())
      .mockRejectedValueOnce(cortada(TETO_SEGURO_DE_SAIDA))
      .mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-curto"), reserva: null }, CTX);
    const r = await porta.objeto(pedido(6000));

    expect(r.ok).toBe(true);
    expect(generateObjectMock.mock.calls[2]![0].maxOutputTokens).toBe(
      TETO_SEGURO_DE_SAIDA * FATOR_DE_ESCALADA,
    );
  });

  it("não desce quando o pedido já está no teto seguro", async () => {
    generateObjectMock.mockRejectedValue(tetoAltoDemais());

    const porta = portaComFallback({ primario: modelo("m-curto"), reserva: null }, CTX);
    await porta.objeto(pedido(TETO_SEGURO_DE_SAIDA));

    // Repetir o mesmo número seria pagar uma requisição para ouvir a mesma
    // recusa.
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("falha comum NÃO é confundida com teto recusado", async () => {
    // A varredura é por texto; um erro que só diga "rate limited" não pode
    // disparar a queda e cortar o espaço do plano pela metade.
    const err = new Error("Provider returned error") as Error & { responseBody?: string };
    err.responseBody = JSON.stringify({ error: { message: "rate limited" } });
    generateObjectMock.mockRejectedValueOnce(err).mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: modelo("m-2") }, CTX);
    await porta.objeto(pedido(6000));

    expect(generateObjectMock.mock.calls[1]![0].model).toBe("m-2");
    expect(generateObjectMock.mock.calls[1]![0].maxOutputTokens).toBe(6000);
  });
});

describe("o que a escalada NÃO pode atropelar", () => {
  it("cancelado por quem pediu não escala nem cai na reserva", async () => {
    // Fechar o painel não é falha de provedor: gastar mais duas chamadas ali é
    // pagar por um resultado que ninguém vai ler.
    const controle = new AbortController();
    controle.abort();
    generateObjectMock.mockRejectedValue(cortada(1000));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: modelo("m-2") }, CTX);
    const r = await porta.objeto({ ...pedido(1000), sinal: controle.signal });

    expect(r.ok).toBe(false);
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });

  it("o corte fica NO LOG mesmo quando a escalada resolve", async () => {
    // "Funciona, mas só na segunda tentativa" não pode ser invisível: é o sinal
    // de que o teto declarado ficou pequeno de novo.
    generateObjectMock
      .mockRejectedValueOnce(cortada(1000))
      .mockResolvedValueOnce(respondeu({ ok: true }));

    const porta = portaComFallback({ primario: modelo("m-1"), reserva: null }, CTX);
    await porta.objeto(pedido(1000));

    const eventos = vi.mocked(logger.warn).mock.calls.map((c) => c[0]);
    expect(eventos).toContain("flow.ai.resposta_cortada");
  });
});
