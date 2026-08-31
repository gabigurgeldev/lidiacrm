import { describe, expect, it } from "vitest";

import { configExemploDoTipo } from "../node-examples";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "../register-all";
import { todosOsNos } from "../registry";
import { montarSchemaDeGeracao } from "./generation-schema";

describe("montarSchemaDeGeracao", () => {
  it("aceita um grafo válido usando o exemplo de CADA tipo registrado", () => {
    esquecerRegistroParaTeste();
    garantirNosRegistrados();
    const schema = montarSchemaDeGeracao();

    // Um nó de cada tipo, cada um com o próprio exemplo canônico — a MESMA
    // função que `FlowCanvas.tsx` usa ao acrescentar um bloco à mão. Se o
    // exemplo de um tipo não bate mais com o configSchema dele, este teste
    // reprova ANTES de a IA tentar gerar contra um schema desatualizado.
    const nodes = todosOsNos().map((def, i) => ({
      id: `n${i}`,
      type: def.type,
      label: def.rotulo,
      config: configExemploDoTipo(def.type),
    }));

    const resultado = schema.safeParse({ nodes, edges: [] });
    if (!resultado.success) {
      throw new Error(`schema recusou grafo válido: ${JSON.stringify(resultado.error.issues, null, 2)}`);
    }
    expect(resultado.success).toBe(true);
  });

  it("recusa type desconhecido", () => {
    esquecerRegistroParaTeste();
    garantirNosRegistrados();
    const schema = montarSchemaDeGeracao();

    const resultado = schema.safeParse({
      nodes: [{ id: "n1", type: "tipo.que.nao.existe", label: "X", config: {} }],
      edges: [],
    });
    expect(resultado.success).toBe(false);
  });

  it("recusa config que não bate com o configSchema do tipo", () => {
    esquecerRegistroParaTeste();
    garantirNosRegistrados();
    const schema = montarSchemaDeGeracao();

    // `logic.wait` exige `duracao_ms` numérico dentro do teto de produto.
    const resultado = schema.safeParse({
      nodes: [{ id: "n1", type: "logic.wait", label: "Esperar", config: { duracao_ms: "muito" } }],
      edges: [],
    });
    expect(resultado.success).toBe(false);
  });

  it("aceita aresta referenciando o branch_id pega-tudo 'else'", () => {
    esquecerRegistroParaTeste();
    garantirNosRegistrados();
    const schema = montarSchemaDeGeracao();

    const resultado = schema.safeParse({
      nodes: [
        { id: "a", type: "trigger.lead_created", label: "Início", config: {} },
        { id: "b", type: "logic.end", label: "Fim", config: { desfecho: "concluido" } },
      ],
      edges: [{ id: "a-else-b", source: "a", target: "b", branch_id: "else" }],
    });
    expect(resultado.success).toBe(true);
  });

  it("exige ao menos 1 nó", () => {
    esquecerRegistroParaTeste();
    garantirNosRegistrados();
    const schema = montarSchemaDeGeracao();
    expect(schema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
  });
});
