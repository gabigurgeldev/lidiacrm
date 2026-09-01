/**
 * O SCHEMA DO PLANO PRECISA CABER NUM PROVEDOR — E ISSO NÃO TEM SINTOMA LOCAL.
 *
 * O schema anterior compilava, passava nos testes e era recusado por TODO
 * provedor, sempre. Três correções foram gastas antes de a causa aparecer, e
 * ela nunca foi outra coisa senão a FORMA do JSON Schema:
 *
 *   `oneOf`     recusado (só `anyOf` é aceito por saída estruturada)
 *   `$ref`      não suportado pelo Gemini; a chamada falha inteira
 *   `{}`        propriedade sem `type` — recusada em modo estrito
 *   união grande o modelo erra a variante e a validação apaga o grafo inteiro
 *
 * Medido no schema antigo: 8.645 bytes, `anyOf` de 11 variantes. O schema do
 * plano não tem união NENHUMA — `tipo` é um enum, que é a forma mais simples
 * que um JSON Schema tem. Este arquivo é o que impede a união de voltar.
 */
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { montarSchemaDePlano } from "./plan-schema";
import { garantirNosRegistrados } from "../register-all";
import { tiposRegistrados } from "../registry";

function jsonDoPlano(): Record<string, unknown> {
  return z.toJSONSchema(montarSchemaDePlano(), { io: "input" }) as Record<string, unknown>;
}

/** Varre o JSON Schema inteiro, em qualquer profundidade. */
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

describe("schema do plano cabe no provedor", () => {
  it("tem OBJETO na raiz — nunca união", () => {
    const json = jsonDoPlano();
    expect(json.type).toBe("object");
    expect(json.anyOf).toBeUndefined();
    expect(json.oneOf).toBeUndefined();
  });

  it("não tem anyOf nem oneOf em profundidade nenhuma", () => {
    const achados: string[] = [];
    varrer(jsonDoPlano(), (chave) => {
      if (chave === "anyOf" || chave === "oneOf") achados.push(chave);
    });
    expect(
      achados,
      `o schema do plano voltou a ter união (${achados.join(", ")}). O plano existe ` +
        `justamente para NÃO ter: escolher a variante certa 20 vezes seguidas é o que ` +
        `o modelo errava, e um erro apagava o grafo inteiro.`,
    ).toEqual([]);
  });

  it("não tem $ref nem $defs", () => {
    const achados: string[] = [];
    varrer(jsonDoPlano(), (chave) => {
      if (chave === "$ref" || chave === "$defs") achados.push(chave);
    });
    expect(achados, "o Gemini não suporta $ref e a chamada falha inteira.").toEqual([]);
  });

  it("nenhuma propriedade tem schema vazio", () => {
    const vazias: string[] = [];
    varrer(jsonDoPlano(), (chave, valor) => {
      if (chave !== "properties" || typeof valor !== "object" || valor === null) return;
      for (const [nome, sub] of Object.entries(valor as Record<string, unknown>)) {
        if (typeof sub === "object" && sub !== null && Object.keys(sub).length === 0) {
          vazias.push(nome);
        }
      }
    });
    expect(vazias, "propriedade sem `type` é recusada em modo estrito.").toEqual([]);
  });

  /**
   * O teto é 2.500 e não 1.500 porque 1.500 era um palpite, e o número medido é
   * 1.779 — quase todo ele nas descrições de campo, que são o que faz o modelo
   * escrever uma `intencao` útil em vez de repetir o rótulo. Cortar descrição
   * para caber num número inventado pioraria a geração para agradar um teste.
   *
   * O que o teto guarda é a REGRESSÃO estrutural: 8.645 bytes era o schema que
   * embutia os 11 configs, e é para lá que se volta se alguém "só acrescentar"
   * um campo de config ao plano. Entre 1.779 e 2.500 há espaço para um campo
   * novo honesto e não há espaço para os configs voltarem.
   */
  it("é pequeno — o schema de uma chamada só tinha 8.645 bytes", () => {
    const bytes = JSON.stringify(jsonDoPlano()).length;
    expect(bytes, `o schema do plano tem ${bytes} bytes; config voltou para dentro dele?`)
      .toBeLessThan(2500);
  });

  /**
   * O invariante que veio do schema antigo, e o mais importante deles: o
   * subconjunto oferecido à IA não pode ESCONDER um tipo de bloco. Um nó novo
   * registrado amanhã tem de entrar no enum sozinho — se alguém trocar o enum
   * derivado por uma lista à mão, o bloco novo fica invisível para a geração e
   * ninguém percebe, porque nada quebra.
   */
  it("o enum de tipo contém TODOS os tipos registrados", () => {
    garantirNosRegistrados();
    const json = jsonDoPlano() as {
      properties: { blocos: { items: { properties: { tipo: { enum: string[] } } } } };
    };
    expect([...json.properties.blocos.items.properties.tipo.enum].sort()).toEqual(
      [...tiposRegistrados()].sort(),
    );
  });

  it("continuam existindo pelo menos 11 tipos de bloco", () => {
    garantirNosRegistrados();
    expect(tiposRegistrados().length).toBeGreaterThanOrEqual(11);
  });
});
