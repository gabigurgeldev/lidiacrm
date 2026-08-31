/**
 * SCHEMA DE `generateObject`/`streamObject` NÃO PODE TER UNIÃO NA RAIZ.
 *
 * Structured Outputs de APIs compatíveis com OpenAI — e a OpenRouter, que é o
 * caminho recomendado do self-host, é uma delas — não aceitam `anyOf` no nível
 * RAIZ do JSON Schema. Uma união aninhada é aceita; uma união no topo, não.
 *
 * O defeito que originou este arquivo: `app/api/v1/flows/[id]/ai/interpretar`
 * pedia `z.discriminatedUnion("kind", [...])` na raiz. "Criar fluxo com IA"
 * estava quebrado desde o primeiro dia, para toda instalação com OpenRouter, e
 * o sintoma mudava conforme o modelo — nenhum dos dois apontando para o schema:
 *
 *   anthropic/claude-haiku-4-5     "could not parse the response"    ~6s
 *   google/gemini-2.5-flash-lite   "response did not match schema"   ~1s
 *
 * Por que um teste e não uma convenção escrita: este erro NÃO TEM SINTOMA
 * LOCAL. `zod` aceita, o TypeScript aceita, o build passa, e a suíte inteira
 * fica verde — a recusa só existe do outro lado, contra um provedor real, que
 * teste nenhum daqui chama. Sem esta cerca, o próximo schema de IA repete.
 *
 * A varredura é do TEXTO dos arquivos, de propósito: importar cada rota para
 * inspecionar o schema exigiria subir `env`, Supabase e o registry de nós, e um
 * teste que precisa de meio sistema de pé para vigiar uma regra de forma acaba
 * desligado na primeira vez que quebra por outro motivo.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { montarSchemaDeGeracao } from "./generation-schema";

const RAIZ = process.cwd();

/**
 * Arquivos que chamam `generateObject`/`streamObject`. Lista explícita, não
 * glob: um arquivo novo que escape daqui é pego por `a-lista-esta-completa`,
 * logo abaixo, que varre o repositório de verdade.
 */
const ARQUIVOS = [
  "app/api/v1/flows/[id]/ai/interpretar/route.ts",
  "app/api/v1/flows/[id]/ai/gerar/route.ts",
  "workers/ai-sentiment-worker.ts",
];

/**
 * Casa `const <nome>Schema = z.discriminatedUnion(` ou `z.union(` — ou seja, a
 * união sendo o VALOR DE TOPO de uma declaração, que é a forma que vira `anyOf`
 * na raiz. União dentro de `z.object({ ... })` não casa, e é justamente a que
 * continua permitida.
 */
const UNIAO_NA_RAIZ = /=\s*z\s*\.\s*(discriminatedUnion|union)\s*\(/;

describe("schema de saída de IA", () => {
  it.each(ARQUIVOS)("%s não declara união na raiz", (rel) => {
    const fonte = readFileSync(join(RAIZ, rel), "utf8");
    const linhas = fonte.split("\n");

    const culpadas = linhas
      .map((linha, i) => ({ linha: linha.trim(), n: i + 1 }))
      .filter(({ linha }) => UNIAO_NA_RAIZ.test(linha));

    expect(
      culpadas,
      `${rel}: união na raiz de um schema. Achate para z.object({...}) com campos ` +
        `opcionais e valide a coerência no código — ver o cabeçalho de interpretar/route.ts. ` +
        `Linhas: ${culpadas.map((c) => c.n).join(", ")}`,
    ).toEqual([]);
  });

  /**
   * A lista acima é explícita, e lista explícita apodrece. Esta varredura é o
   * que impede que um emissor NOVO nasça fora da vigilância — sem ela, a cerca
   * protegeria exatamente os três arquivos que já estão consertados.
   */
  it("a-lista-esta-completa: todo emissor de generateObject/streamObject está coberto", () => {
    const achados = execSync(
      'git grep -l -E "generateObject|streamObject" -- "app/**/*.ts" "lib/**/*.ts" "workers/**/*.ts"',
      { cwd: RAIZ, encoding: "utf8" },
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      // O próprio teste e os testes em geral citam os nomes sem os emitir.
      .filter((p) => !p.endsWith(".test.ts"));

    const naoCobertos = achados.filter((p) => !ARQUIVOS.includes(p));

    expect(
      naoCobertos,
      `emissor de IA fora da lista ARQUIVOS deste teste: ${naoCobertos.join(", ")}. ` +
        `Acrescente à lista (e confira que o schema dele não tem união na raiz).`,
    ).toEqual([]);
  });

  /**
   * O schema de `ai/gerar` é montado em runtime a partir do registry de nós,
   * então a varredura de texto não o alcança — e ele é o maior do produto.
   * Aqui a checagem é sobre o objeto Zod de verdade.
   */
  it("o schema de geração tem OBJETO na raiz, com a união aninhada dentro", () => {
    const schema = montarSchemaDeGeracao();
    expect(schema.constructor.name).toBe("ZodObject");

    // A união segue existindo — ela é legítima aqui, dentro de `nodes`.
    const forma = schema.shape;
    expect(Object.keys(forma).sort()).toEqual(["edges", "nodes"]);
  });
});
