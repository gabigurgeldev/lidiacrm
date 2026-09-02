/**
 * O TETO DE TOKENS DO PLANO — a cerca em volta do número que quebrou a feature.
 *
 * ═══ O defeito ═══
 *
 * A rota do plano pedia `maxOutputTokens: 1200`, com um comentário afirmando
 * que era "folgado para 40 blocos". Medido contra o provedor real, a afirmação
 * era falsa por uma ordem de grandeza — e o modo como ela falhava é o que a
 * tornou cara:
 *
 *   pedido de exemplo (8 blocos)      826 · 1043 · 1068 · 1096 · 1106 · 1166
 *   pedido de tamanho normal (15)     cortado em 4 de 4 rodadas; a rodada que
 *                                     coube num teto maior gastou 6006
 *
 * O corte chega como `could not parse the response` — uma frase sobre PARSE —
 * e mandou cinco correções procurarem no schema, no provedor e no transporte.
 *
 * ═══ O que estes casos impedem ═══
 *
 * Duas coisas, e as duas já aconteceram neste arquivo de rota:
 *
 *   1. o número voltar a ser escrito NA ROTA, longe dos limites que ele existe
 *      para comportar — foi assim que ele envelheceu sem ninguém ver;
 *   2. o teto, DEPOIS da escalada, deixar de cobrir um plano de tamanho
 *      realmente medido.
 *
 * ⚠️ O que estes casos NÃO provam: que o número é o ideal. Nenhum teste offline
 * responde isso — quem responde é o provedor, e a resposta muda com o modelo. É
 * por isso que o desenho não depende de acertar o número: a porta sobe o teto
 * quando a resposta volta cortada.
 *
 * ⚠️ E o que eles NÃO medem, porque nenhum teste offline mede: teto alto NÃO
 * custa nada. Cobra-se pelo token gerado, não pelo autorizado. Quem decide o
 * custo é o MODELO e o número de CHAMADAS — daí o último caso deste arquivo.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FATOR_DE_ESCALADA, TETO_MAXIMO_DE_SAIDA } from "./modelo-com-fallback";
import { MAX_BLOCOS, TOKENS_DO_PLANO } from "./plan-schema";

const RAIZ = process.cwd();
const ROTA = "app/api/v1/flows/[id]/ai/plano/route.ts";

/**
 * A fonte SEM comentários.
 *
 * Esta rota é das mais comentadas do repositório, e os comentários CITAM o
 * número antigo (`1200`) de propósito, para quem lê saber de onde se veio. Uma
 * cerca que procure dígitos no arquivo inteiro reprovaria por causa da prosa —
 * ou, pior, passaria a verde com o literal de volta no código porque já contava
 * com dígitos na prosa.
 */
function codigoDaRota(): string {
  return readFileSync(join(RAIZ, ROTA), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("o teto do plano não mora na rota", () => {
  it("a rota pede o teto pelo NOME, nunca por um número", () => {
    const codigo = codigoDaRota();
    const pedido = codigo.match(/maxOutputTokens:\s*([^,\n]+)/);

    expect(pedido, `${ROTA}: nenhum maxOutputTokens encontrado`).not.toBeNull();
    expect(
      pedido![1]!.trim(),
      `${ROTA}: o teto voltou a ser um literal na rota. Ele mora em plan-schema.ts, ` +
        `ao lado de MAX_BLOCOS/MAX_LIGACOES, que são o que ele precisa comportar — ` +
        `longe deles foi exatamente como o 1200 envelheceu sem ninguém ver.`,
    ).toBe("TOKENS_DO_PLANO");
  });

  it("o teto vive ao lado dos limites que ele comporta", () => {
    const schema = readFileSync(join(RAIZ, "lib/flow-engine/ai/plan-schema.ts"), "utf8");
    // Mesmo arquivo que MAX_BLOCOS: mexer num obriga a ver o outro.
    expect(schema).toContain("export const TOKENS_DO_PLANO");
    expect(schema).toContain("export const MAX_BLOCOS");
  });
});

describe("o teto cobre um plano de tamanho medido", () => {
  /**
   * O maior plano que este repositório MEDIU contra o provedor real: 15 blocos,
   * 6006 tokens de saída, `finishReason: "stop"`. Não é o pior caso do schema
   * (`MAX_BLOCOS` é 40) — é o maior caso observado, e é a única régua honesta
   * que um teste offline tem.
   */
  const PLANO_MEDIDO_EM_TOKENS = 6006;

  it("depois da escalada, cabe o maior plano medido", () => {
    expect(
      TOKENS_DO_PLANO * FATOR_DE_ESCALADA,
      `o teto escalado (${TOKENS_DO_PLANO} × ${FATOR_DE_ESCALADA}) não cobre os ` +
        `${PLANO_MEDIDO_EM_TOKENS} tokens de um plano de 15 blocos medido contra o provedor. ` +
        `Um plano desse tamanho voltaria a falhar como "could not parse the response".`,
    ).toBeGreaterThanOrEqual(PLANO_MEDIDO_EM_TOKENS);
  });

  it("a escalada não é cortada pelo teto máximo", () => {
    // Se o máximo ficasse abaixo do teto escalado, a escalada seria silenciosa:
    // a porta pediria mais espaço e receberia o mesmo de antes.
    expect(TOKENS_DO_PLANO * FATOR_DE_ESCALADA).toBeLessThanOrEqual(TETO_MAXIMO_DE_SAIDA);
  });

  it("o teto comporta o MAIOR plano que o schema permite", () => {
    // O invariante que faltava, e cuja ausência é o defeito inteiro: o schema
    // PROMETE até MAX_BLOCOS, e o teto autorizava uma fração disso. Um limite
    // escondido menor que o limite declarado não é economia — é a feature
    // quebrando em pedido de tamanho real.
    //
    // Medido: 8 blocos e 7 ligações couberam em 714 tokens de saída.
    const MEDIDO_8_BLOCOS = 714;
    const porBloco = MEDIDO_8_BLOCOS / 8;
    expect(
      TOKENS_DO_PLANO,
      `o teto (${TOKENS_DO_PLANO}) não comporta os ${MAX_BLOCOS} blocos que o schema ` +
        `promete (~${Math.round(porBloco * MAX_BLOCOS)} tokens). Teto alto não custa nada: ` +
        `cobra-se pelo token gerado, não pelo autorizado.`,
    ).toBeGreaterThanOrEqual(porBloco * MAX_BLOCOS);
  });
});

describe("a geração começa pelo modelo BARATO", () => {
  it("o padrão da cadeia é o classificador, e o carro-chefe é a reserva", () => {
    // Gerar fluxo é extração estruturada — escolher tipos de uma lista fechada
    // e escrever rótulos curtos —, não conversa com cliente. Medido: o
    // carro-chefe gastou 6006 tokens de saída num plano cujo JSON tem ~1400, e
    // levou 55-77s; o classificador fez o mesmo plano em 8,4s. Somado ao preço
    // por token, a geração inteira sai de ~US$ 0,116 para ~US$ 0,035.
    //
    // A ordem é lida da ASSINATURA porque é ela que os dois chamadores herdam:
    // as rotas chamam `resolverCadeia(purpose, orgId)` com dois argumentos.
    const fonte = readFileSync(join(RAIZ, "lib/flow-engine/ai/modelo-com-fallback.ts"), "utf8");
    const assinatura = fonte.match(
      /export async function resolverCadeia\([\s\S]*?\): Promise<CadeiaDeModelos \| null>/,
    );
    expect(assinatura, "assinatura de resolverCadeia não encontrada").not.toBeNull();
    const texto = assinatura![0];

    expect(
      /padrao: ModelId = DEFAULT_CLASSIFIER_MODEL/.test(texto),
      "o padrão da geração voltou a ser o carro-chefe. Ele custa o dobro por token " +
        "e gastou 4× mais tokens no mesmo plano — ver a medição no cabeçalho da função.",
    ).toBe(true);
    expect(
      /reserva: ModelId = DEFAULT_BOT_MODEL/.test(texto),
      "o carro-chefe precisa continuar como RESERVA: ele entra quando o barato falha, " +
        "e tirá-lo dali deixaria a geração sem segundo caminho.",
    ).toBe(true);
  });
});
