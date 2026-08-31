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
