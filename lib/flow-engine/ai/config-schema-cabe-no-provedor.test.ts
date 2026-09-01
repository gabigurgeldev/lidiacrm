/**
 * O CONFIG DE CADA TIPO, ISOLADO, PRECISA CABER NUM PROVEDOR.
 *
 * A cerca antiga media o schema INTEIRO da geração — um objeto só, com os 11
 * configs embutidos numa união. Ela pegava a doença no agregado: bastava um
 * tipo hostil para o arquivo inteiro reprovar, e a mensagem não dizia qual.
 *
 * Aqui a medição é por tipo, que é como a geração passou a pedir: uma chamada
 * por bloco, com o schema daquele tipo e de mais nenhum. Um nó novo cujo
 * `configSchema` use `discriminatedUnion` ou `z.lazy` recursivo reprova
 * NOMEANDO o tipo — e o conserto é declarar o override em
 * `CONFIG_PARA_GERACAO`, não deformar o schema de runtime.
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { schemaDeConfigParaGeracao, tiposSemConfig } from "./config-para-geracao";
import { garantirNosRegistrados } from "../register-all";
import { tiposRegistrados } from "../registry";

function varrer(no: unknown, visita: (chave: string, valor: unknown) => void): void {
  const fila: unknown[] = [no];
  while (fila.length > 0) {
    const atual = fila.shift();
    if (Array.isArray(atual)) {
      fila.push(...atual);
      continue;
    }
    if (typeof atual !== "object" || atual === null) continue;
    for (const [chave, valor] of Object.entries(atual)) {
      visita(chave, valor);
      fila.push(valor);
    }
  }
}

function tiposComConfig(): string[] {
  garantirNosRegistrados();
  const sem = new Set(tiposSemConfig());
  return tiposRegistrados().filter((t) => !sem.has(t));
}

describe("config de cada tipo cabe no provedor", () => {
  it("há tipos com config a pedir — senão esta cerca não mede nada", () => {
    expect(tiposComConfig().length).toBeGreaterThanOrEqual(8);
  });

  /**
   * `anyOf` NÃO é proibido aqui, e a diferença é medida, não estética.
   *
   *   z.discriminatedUnion(...)  ->  oneOf   recusado por saída estruturada
   *   z.union(...)               ->  anyOf   aceito
   *
   * `logic.if` tem `valor: z.union([string, number, boolean])`, que emite
   * `anyOf` para um escalar — e é assim de propósito: a alternativa era
   * `z.unknown()`, que emite `{}` (schema sem `type`), esse sim recusado.
   * Proibir `anyOf` aqui reprovaria a forma que consertou o defeito.
   *
   * O que continua proibido é a união GRANDE na estrutura — 11 variantes de
   * bloco —, e ela não pode voltar porque o plano nem pede config.
   */
  it.each(tiposComConfig())("%s: objeto na raiz, sem oneOf, sem $ref, sem schema vazio", (tipo) => {
    const schema = schemaDeConfigParaGeracao(tipo);
    expect(schema, `${tipo} deveria ter schema de config`).not.toBeNull();

    const json = z.toJSONSchema(schema!, { io: "input" }) as Record<string, unknown>;
    expect(json.type, `${tipo}: a raiz do config precisa ser objeto`).toBe("object");

    const proibidas: string[] = [];
    const vazias: string[] = [];
    varrer(json, (chave, valor) => {
      if (chave === "oneOf" || chave === "$ref" || chave === "$defs") proibidas.push(chave);
      if (chave === "properties" && typeof valor === "object" && valor !== null) {
        for (const [nome, sub] of Object.entries(valor as Record<string, unknown>)) {
          if (typeof sub === "object" && sub !== null && Object.keys(sub).length === 0) {
            vazias.push(`${tipo}.${nome}`);
          }
        }
      }
    });

    expect(
      proibidas,
      `${tipo}: o config emite ${proibidas.join(", ")}. Saída estruturada recusa. ` +
        `Declare a forma simplificada em CONFIG_PARA_GERACAO (config-para-geracao.ts) — ` +
        `nunca deforme o configSchema de runtime, que é o contrato do motor.`,
    ).toEqual([]);
    expect(vazias, `${tipo}: propriedade sem 'type' é recusada em modo estrito.`).toEqual([]);
  });

  it("os tipos sem config são exatamente os que não têm campo nenhum", () => {
    garantirNosRegistrados();
    // Derivado, e não uma lista à mão: um tipo com config vazia que passasse a
    // ter campos precisa VOLTAR a pedir ao modelo, sozinho.
    expect(tiposSemConfig()).toContain("trigger.lead_created");
    for (const tipo of tiposSemConfig()) {
      expect(schemaDeConfigParaGeracao(tipo)).toBeNull();
    }
  });

  it("tipo desconhecido não tem schema — e não estoura", () => {
    expect(schemaDeConfigParaGeracao("nao.existe")).toBeNull();
  });
});
