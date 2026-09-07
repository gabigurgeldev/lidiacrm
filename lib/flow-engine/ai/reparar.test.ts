/**
 * O reparo conserta o que tem conserto único — e recua onde não tem.
 *
 * As duas metades importam igual. Um reparo que adivinha intenção produz fluxo
 * que PUBLICA e faz a coisa errada, que é pior do que o erro que ele calou: o
 * erro a pessoa vê, o comportamento errado ela descobre no primeiro lead.
 */
import { describe, expect, it } from "vitest";

import { repararGrafo } from "./reparar";
import type { FlowGraph } from "../graph-schema";
import { configExemploDoTipo } from "../node-examples";
import { validarParaPublicar } from "../validate-publish";

function no(id: string, type: string, config?: Record<string, unknown>) {
  return {
    id,
    type,
    label: id,
    position: { x: 0, y: 0 },
    config: config ?? configExemploDoTipo(type),
  };
}

function aresta(source: string, target: string, branch_id = "else") {
  return { id: `${source}_${target}`, source, target, branch_id };
}

describe("bifurcação sem reencontro", () => {
  it("aponta para o único reencontro alcançável", () => {
    const grafo: FlowGraph = {
      nodes: [
        no("t", "trigger.lead_created"),
        no("bifurca", "logic.fork", {
          ramos: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          modo: "todas",
          encontro: "nao_existe",
        }),
        no("junta", "logic.merge"),
        no("fim", "logic.end"),
      ],
      edges: [
        aresta("t", "bifurca"),
        aresta("bifurca", "junta", "a"),
        { id: "e2", source: "bifurca", target: "junta", branch_id: "b" },
        aresta("junta", "fim", "else"),
      ],
    };

    const { grafo: reparado, consertos } = repararGrafo(grafo);

    const bifurca = reparado.nodes.find((n) => n.id === "bifurca")!;
    expect((bifurca.config as { encontro: string }).encontro).toBe("junta");
    expect(consertos.map((c) => c.ancora)).toContain("bifurca");
    expect(validarParaPublicar(reparado).ok).toBe(true);
  });

  it("recua quando há dois reencontros e nenhum é o óbvio", () => {
    const grafo: FlowGraph = {
      nodes: [
        no("t", "trigger.lead_created"),
        no("bifurca", "logic.fork", {
          ramos: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          modo: "todas",
          encontro: "nao_existe",
        }),
        no("junta1", "logic.merge"),
        no("junta2", "logic.merge"),
      ],
      // Nenhum dos dois reencontros é alcançável a partir da bifurcação: não há
      // resposta única, então o reparo não escolhe. Fica para o modelo.
      edges: [aresta("t", "bifurca")],
    };

    const { grafo: reparado, consertos } = repararGrafo(grafo);

    // As saídas soltas da bifurcação são ligadas (reparo de outra natureza,
    // esse tem resposta única) — o que NÃO pode acontecer é escolher um
    // reencontro no chute.
    const bifurca = reparado.nodes.find((n) => n.id === "bifurca")!;
    expect((bifurca.config as { encontro: string }).encontro).toBe("nao_existe");
    expect(consertos.some((c) => c.oQueFoiFeito.includes("reencontrar"))).toBe(false);
  });
});

describe("ligação de volta ao início", () => {
  it("some, e o motivo é dito", () => {
    const grafo: FlowGraph = {
      nodes: [no("t", "trigger.lead_created"), no("marca", "crm.add_tag"), no("fim", "logic.end")],
      edges: [aresta("t", "marca"), aresta("marca", "t")],
    };

    const { grafo: reparado, consertos } = repararGrafo(grafo);

    expect(reparado.edges.some((a) => a.target === "t")).toBe(false);
    expect(consertos.some((c) => c.oQueFoiFeito.includes("de volta ao início"))).toBe(true);
  });
});

describe("saída de regra sem ligação", () => {
  it("passa a terminar o fluxo, reusando o bloco de fim que já existe", () => {
    const grafo: FlowGraph = {
      nodes: [
        no("t", "trigger.lead_created"),
        no("decide", "logic.if"),
        no("fim", "logic.end"),
      ],
      // A saída "s1" (regra) do `logic.if` fica solta: é ela que reprova a
      // publicação, e é ela que o reparo liga.
      edges: [aresta("t", "decide"), aresta("decide", "fim", "else")],
    };

    expect(validarParaPublicar(grafo).ok).toBe(false);

    const { grafo: reparado, consertos } = repararGrafo(grafo);

    expect(reparado.nodes.filter((n) => n.type === "logic.end")).toHaveLength(1);
    expect(reparado.edges.some((a) => a.source === "decide" && a.branch_id === "s1")).toBe(true);
    expect(consertos.some((c) => c.oQueFoiFeito.includes("terminar o fluxo"))).toBe(true);
    expect(validarParaPublicar(reparado).ok).toBe(true);
  });

  it("cria um bloco de fim quando o fluxo não tem nenhum", () => {
    const grafo: FlowGraph = {
      nodes: [no("t", "trigger.lead_created"), no("decide", "logic.if")],
      edges: [aresta("t", "decide")],
    };

    const { grafo: reparado, consertos } = repararGrafo(grafo);

    const fins = reparado.nodes.filter((n) => n.type === "logic.end");
    expect(fins).toHaveLength(1);
    expect(consertos.some((c) => c.oQueFoiFeito.includes("foi criado"))).toBe(true);
    expect(validarParaPublicar(reparado).ok).toBe(true);
  });

  it("não toca em saída de EXCEÇÃO — solta é o comportamento certo dela", () => {
    const grafo: FlowGraph = {
      nodes: [
        no("t", "trigger.lead_created"),
        no("manda", "whatsapp.send_to_lead"),
        no("fim", "logic.end"),
      ],
      edges: [aresta("t", "manda"), aresta("manda", "fim", "else")],
    };

    const { consertos } = repararGrafo(grafo);

    expect(consertos, "as saídas de exceção não deviam ter gerado ligação").toEqual([]);
    expect(validarParaPublicar(grafo).ok).toBe(true);
  });
});

describe("o que o reparo se recusa a adivinhar", () => {
  it("grafo já válido volta intocado, e sem alocar nada", () => {
    const grafo: FlowGraph = {
      nodes: [no("t", "trigger.lead_created"), no("fim", "logic.end")],
      edges: [aresta("t", "fim")],
    };

    const resultado = repararGrafo(grafo);

    expect(resultado.consertos).toEqual([]);
    expect(resultado.grafo).toBe(grafo);
  });

  it("erro de FORMA não é reparado às cegas", () => {
    const grafo: FlowGraph = {
      nodes: [no("t", "tipo.que.nao.existe")],
      edges: [],
    };

    const resultado = repararGrafo(grafo);

    expect(resultado.consertos).toEqual([]);
    expect(resultado.grafo).toBe(grafo);
  });

  it("não escolhe qual aresta de um ciclo cortar", () => {
    const grafo: FlowGraph = {
      nodes: [
        no("t", "trigger.lead_created"),
        no("a", "crm.add_tag"),
        no("b", "crm.add_tag"),
      ],
      edges: [aresta("t", "a"), aresta("a", "b"), aresta("b", "a")],
    };

    const { grafo: reparado } = repararGrafo(grafo);

    // O ciclo continua lá — e continua reprovando. É o resultado certo: cortar
    // uma das duas arestas mudaria o fluxo de um jeito que ninguém pediu.
    expect(validarParaPublicar(reparado).erros.some((e) => e.codigo === "ciclo")).toBe(true);
  });
});
