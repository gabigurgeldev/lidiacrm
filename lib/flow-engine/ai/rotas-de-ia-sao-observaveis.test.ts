/**
 * TODA ROTA QUE FALA COM UM MODELO PRECISA DEIXAR RASTRO.
 *
 * Esta cerca nasceu de duas falhas seguidas na mesma tela, e nas duas o tempo
 * foi gasto no mesmo lugar: descobrir o que tinha acontecido.
 *
 *   1. `ai/interpretar` falhava com 502 e o log do app não tinha uma linha sobre
 *      a rota. Foram três idas e vindas pedindo dados a quem estava na tela
 *      antes de a causa aparecer — e ela só apareceu depois que a rota passou a
 *      registrar início, fim e falha.
 *   2. `ai/gerar` falhava com "A IA não conseguiu terminar o fluxo". O log
 *      estava vazio E o `api_audit_log` também: ZERO linhas. A rota tinha um
 *      `onFinish` que auditava a falha, e o vazio dele foi a primeira pista de
 *      que o erro acontecia ANTES do fim do stream, onde nada olhava.
 *
 * O que torna essa classe de defeito tão cara é que ela não tem sintoma local:
 * a rota compila, os testes passam, e o buraco só existe em produção, no minuto
 * em que alguém precisa saber por que a tela não funcionou.
 *
 * Streaming é o caso mais grave e por isso tem regra própria. `streamObject`
 * envia os cabeçalhos 200 ANTES de o modelo terminar: um erro depois disso não
 * pode virar status HTTP, vira stream truncado, e sem `onError` o SDK o engole
 * inteiro. Ali o callback não é boa prática — é o único ponto de observação
 * que existe.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = process.cwd();

/** Rotas HTTP que chamam um modelo. Completude vigiada pelo último caso. */
const ROTAS = [
  "app/api/v1/flows/[id]/ai/interpretar/route.ts",
  "app/api/v1/flows/[id]/ai/gerar/route.ts",
];

function fonteDe(rel: string): string {
  return readFileSync(join(RAIZ, rel), "utf8");
}

/**
 * A fonte SEM comentários — e isto não é preciosismo.
 *
 * Estas rotas são das mais comentadas do repositório: cada correção deixou o
 * porquê escrito, e os comentários citam os nomes dos campos. Uma cerca que
 * procure `finishReason` no arquivo inteiro passa a verde com o campo APAGADO
 * do código, porque o parágrafo que explica o campo continua lá. Medido: a
 * sabotagem de remover as duas linhas do `logger` não reprovou.
 *
 * Regex e não parser de propósito: o alvo é `logger.x({ campo })`, e nenhuma
 * das rotas tem `//` dentro de string literal.
 */
function codigoDe(rel: string): string {
  return fonteDe(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Os PAYLOADS de `logger.*` — não o arquivo inteiro.
 *
 * A diferença é o que separa cerca de teatro. Procurar `finishReason` no
 * arquivo passa a verde com o campo apagado de todo `logger`, porque o nome
 * sobrevive na desestruturação do callback (`onFinish: ({ …, finishReason })`)
 * e no parágrafo que explica o campo. As duas sabotagens foram medidas aqui, e
 * as duas passaram na versão anterior desta cerca.
 *
 * O que interessa é o campo CHEGAR ao log, então é o objeto do `logger` que é
 * lido — e nada mais.
 */
function payloadsDeLog(rel: string): string {
  const codigo = codigoDe(rel);
  const blocos = codigo.match(/logger\.(?:info|warn|error)\([\s\S]*?\n(\s*)\}\);/g) ?? [];
  return blocos.join("\n");
}

describe("rotas de IA são observáveis", () => {
  it.each(ROTAS)("%s registra o INÍCIO da chamada", (rel) => {
    const fonte = fonteDe(rel);
    expect(
      /logger\.(info|warn)\(\s*["'`][\w.]*inicio/.test(fonte),
      `${rel}: sem log de início. Sem ele não se distingue "o pedido nunca chegou" ` +
        `de "o provedor demorou" — e essa distinção foi o que travou duas investigações.`,
    ).toBe(true);
  });

  it.each(ROTAS)("%s registra a FALHA com a causa", (rel) => {
    const fonte = fonteDe(rel);
    expect(
      /logger\.error\(/.test(fonte) && /causa:/.test(fonte),
      `${rel}: sem logger.error com o campo 'causa'. A frase que chega à tela é ` +
        `genérica de propósito; a causa precisa existir no servidor.`,
    ).toBe(true);
  });

  it.each(ROTAS)("%s: se usa streamObject, declara onError", (rel) => {
    const fonte = fonteDe(rel);
    if (!/streamObject\(/.test(fonte)) return; // regra só vale para streaming

    expect(
      /onError:\s*\(/.test(fonte),
      `${rel}: streamObject sem onError. Os cabeçalhos 200 já saíram quando o modelo ` +
        `falha, então o erro NÃO vira status HTTP — vira stream truncado, e o SDK o ` +
        `engole. onError é o único ponto em que essa causa é observável.`,
    ).toBe(true);
  });

  /**
   * A regra que faltava, e ela custou uma investigação inteira.
   *
   * `finishReason` separa duas causas OPOSTAS que chegam à tela com a mesma
   * frase: `"length"` é o teto de tokens cortando o JSON no meio; `"stop"` é o
   * modelo terminando e a validação recusando. Uma se conserta com mais tokens,
   * a outra com outro schema — e sem este campo não há como escolher.
   *
   * `warnings` é onde o SDK registra que o provedor IGNOROU um ajuste. É assim
   * que se descobre que a OpenRouter descartou o `response_format`, em vez de
   * deduzir isso do silêncio.
   *
   * O mais caro deste defeito: os dois campos JÁ vinham do SDK, de graça, nos
   * dois pontos — e eram descartados na desestruturação.
   */
  it.each(ROTAS)("%s registra finishReason e warnings do provedor", (rel) => {
    const fonte = payloadsDeLog(rel);
    expect(
      /finishReason/.test(fonte),
      `${rel}: não registra 'finishReason'. Sem ele, "o teto de tokens cortou" e ` +
        `"a validação recusou" chegam ao log como a mesma coisa — e o conserto de ` +
        `uma não serve para a outra.`,
    ).toBe(true);
    expect(
      /warnings/.test(fonte),
      `${rel}: não registra os 'warnings' do SDK. É o único lugar em que o provedor ` +
        `avisa que IGNOROU um ajuste nosso (o response_format, tipicamente).`,
    ).toBe(true);
  });

  it("a-lista-esta-completa: nenhuma rota de IA fica fora desta cerca", () => {
    const achados = execSync(
      'git grep -l -E "generateObject|streamObject" -- "app/api/**/route.ts"',
      { cwd: RAIZ, encoding: "utf8" },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const fora = achados.filter((p) => !ROTAS.includes(p));
    expect(
      fora,
      `rota de IA fora da cerca: ${fora.join(", ")}. Acrescente à lista ROTAS — e ` +
        `garanta que ela registra início, falha com causa, e onError se for streaming.`,
    ).toEqual([]);
  });
});
