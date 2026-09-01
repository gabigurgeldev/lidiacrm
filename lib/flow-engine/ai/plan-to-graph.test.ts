/**
 * A MONTAGEM É DETERMINÍSTICA — E É ELA QUE IMPEDE O GRAFO MUDO.
 *
 * O caso que dá nome a este arquivo é a reconciliação de ramo. O plano nomeia a
 * saída por RÓTULO ("Score alto"); o grafo exige `branch_id`, que só existe
 * depois que o config do `logic.if` foi gerado. Se as duas pontas não casam, a
 * aresta aponta para um handle inexistente — e `analisarGrafo` NÃO reclama,
 * porque ele valida nós, não destino de ramo. O fluxo desenha bonito e não segue
 * por ali no primeiro lead.
 *
 * Só um teste pega isso. É por isso que ele existe.
 */
import { describe, expect, it } from "vitest";

import { planoParaGrafo, type ConfigResolvida } from "./plan-to-graph";
import type { PlanoDeFluxo } from "./plan-schema";
import { analisarGrafo, flowGraphSchema } from "../graph-schema";
import { garantirNosRegistrados } from "../register-all";

garantirNosRegistrados();

function config(config: Record<string, unknown>, origem: "ia" | "exemplo" = "ia"): ConfigResolvida {
  return { config, origem };
}

const planoLinear: PlanoDeFluxo = {
  blocos: [
    { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
    { id: "w1", tipo: "logic.wait", rotulo: "Espera 10 min", intencao: "esperar 10 minutos" },
    { id: "f1", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
  ],
  ligacoes: [
    { de: "t1", para: "w1" },
    { de: "w1", para: "f1" },
  ],
};

describe("planoParaGrafo", () => {
  it("monta uma cadeia linear que passa no schema e no analisarGrafo", () => {
    const { grafo, valido, comExemplo } = planoParaGrafo(
      planoLinear,
      new Map([
        ["t1", config({})],
        ["w1", config({ duracao_ms: 600_000 })],
        ["f1", config({ desfecho: "concluido" })],
      ]),
    );

    expect(valido).toBe(true);
    expect(comExemplo).toBe(0);
    expect(flowGraphSchema.safeParse(grafo).success).toBe(true);

    const analisado = analisarGrafo(grafo);
    expect(analisado.erros, JSON.stringify(analisado.erros)).toEqual([]);
    expect(grafo.edges.map((e) => e.branch_id)).toEqual(["else", "else"]);
    // Posição vem do auto-layout, nunca do modelo: nós distintos, colunas distintas.
    expect(new Set(grafo.nodes.map((n) => n.position.x)).size).toBeGreaterThan(1);
  });

  it("liga o ramo do logic.if ao id REAL da saída, casando pelo rótulo", () => {
    const plano: PlanoDeFluxo = {
      blocos: [
        { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
        { id: "se", tipo: "logic.if", rotulo: "Score alto?", intencao: "decidir por score" },
        { id: "tag", tipo: "crm.add_tag", rotulo: "Marca quente", intencao: "etiquetar" },
        { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
      ],
      ligacoes: [
        { de: "t1", para: "se" },
        { de: "se", para: "tag", ramo: "Score alto" },
        { de: "se", para: "fim" },
      ],
    };
    const { grafo, valido } = planoParaGrafo(
      plano,
      new Map([
        ["t1", config({})],
        [
          "se",
          config({
            saidas: [
              {
                // O id que o modelo escolheu na etapa 2 — o plano não o conhecia.
                id: "saida_quente",
                label: "Score alto",
                quando: {
                  combinador: "and",
                  itens: [{ campo: "lead.score", op: "gt", valor: 70 }],
                },
              },
            ],
          }),
        ],
        ["tag", config({ tag: "quente" })],
        ["fim", config({ desfecho: "concluido" })],
      ]),
    );

    expect(valido).toBe(true);
    const paraTag = grafo.edges.find((e) => e.target === "tag");
    expect(
      paraTag?.branch_id,
      "a aresta do ramo tem de apontar para o id REAL da saída; apontando para o " +
        "rótulo, o handle não existe e o fluxo para em silêncio no primeiro lead.",
    ).toBe("saida_quente");
    // A ligação sem ramo continua no pega-tudo.
    expect(grafo.edges.find((e) => e.target === "fim")?.branch_id).toBe("else");

    // E o grafo inteiro segue válido para o motor.
    expect(analisarGrafo(grafo).erros).toEqual([]);
  });

  it("o RÓTULO vence a ordem — mesmo com as saídas invertidas no config", () => {
    /**
     * O caso que separa as duas regras, e ele não existia.
     *
     * Os testes vizinhos provam que o rótulo casa e que a ordem é a rede, mas
     * nos dois a ordem e o rótulo apontam para o MESMO lugar: uma implementação
     * que ignorasse o rótulo e usasse só a posição passaria em ambos.
     *
     * Aqui o config declara as saídas ao contrário da ordem das ligações. Pela
     * posição, cada aresta iria para o ramo errado; pelo rótulo, cada uma vai
     * para o seu. É a garantia de que o conserto da etapa 2 — mandar os rótulos
     * do plano para dentro do prompt do config — tem quem o receba.
     */
    const plano: PlanoDeFluxo = {
      blocos: [
        { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
        { id: "se", tipo: "logic.if", rotulo: "Decide", intencao: "decidir" },
        { id: "quente", tipo: "crm.add_tag", rotulo: "Marca", intencao: "etiquetar" },
        { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
      ],
      ligacoes: [
        { de: "t1", para: "se" },
        { de: "se", para: "quente", ramo: "Score alto" },
        { de: "se", para: "fim", ramo: "Score baixo" },
      ],
    };
    const { grafo, valido } = planoParaGrafo(
      plano,
      new Map([
        ["t1", config({})],
        [
          "se",
          config({
            // INVERTIDAS de propósito: "Score baixo" é a saída[0].
            saidas: [
              {
                id: "s_baixo",
                label: "Score baixo",
                quando: { combinador: "and", itens: [{ campo: "lead.score", op: "lt", valor: 70 }] },
              },
              {
                id: "s_alto",
                label: "Score alto",
                quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 70 }] },
              },
            ],
          }),
        ],
        ["quente", config({ tag: "quente" })],
        ["fim", config({ desfecho: "concluido" })],
      ]),
    );

    expect(valido).toBe(true);
    expect(
      grafo.edges.find((e) => e.target === "quente")?.branch_id,
      "pela ORDEM esta aresta iria para s_baixo — o rótulo é que a salva",
    ).toBe("s_alto");
    expect(grafo.edges.find((e) => e.target === "fim")?.branch_id).toBe("s_baixo");
    expect(analisarGrafo(grafo).erros).toEqual([]);
  });

  it("cai na ORDEM quando o rótulo do plano não bate com o do config", () => {
    const plano: PlanoDeFluxo = {
      blocos: [
        { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
        { id: "se", tipo: "logic.if", rotulo: "Decide", intencao: "decidir" },
        { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
      ],
      ligacoes: [
        { de: "t1", para: "se" },
        { de: "se", para: "fim", ramo: "rótulo que o config não tem" },
      ],
    };
    const { grafo } = planoParaGrafo(
      plano,
      new Map([
        ["t1", config({})],
        [
          "se",
          config({
            saidas: [
              {
                id: "s1",
                label: "Outro nome",
                quando: { combinador: "and", itens: [{ campo: "lead.score", op: "gt", valor: 1 }] },
              },
            ],
          }),
        ],
        ["fim", config({ desfecho: "concluido" })],
      ]),
    );
    expect(grafo.edges.find((e) => e.target === "fim")?.branch_id).toBe("s1");
  });

  it("bloco com config falhada recebe o exemplo — e o grafo continua válido", () => {
    const { grafo, valido, comExemplo } = planoParaGrafo(
      planoLinear,
      new Map([
        ["t1", config({})],
        // O modelo falhou neste bloco duas vezes.
        ["w1", { config: {}, origem: "exemplo", causa: "provedor recusou" }],
        ["f1", config({ desfecho: "concluido" })],
      ]),
    );

    expect(valido).toBe(true);
    expect(comExemplo).toBe(1);
    // A prova que importa: o fluxo NÃO foi apagado por causa de um bloco.
    expect(grafo.nodes).toHaveLength(3);
    expect(analisarGrafo(grafo).erros).toEqual([]);
    expect((grafo.nodes.find((n) => n.id === "w1")?.config as { duracao_ms: number }).duracao_ms)
      .toBeGreaterThan(0);
  });

  it("descarta aresta órfã sem derrubar o resto", () => {
    const plano: PlanoDeFluxo = {
      ...planoLinear,
      ligacoes: [...planoLinear.ligacoes, { de: "w1", para: "nao_existe" }],
    };
    const { grafo, descartes } = planoParaGrafo(
      plano,
      new Map([
        ["t1", config({})],
        ["w1", config({ duracao_ms: 600_000 })],
        ["f1", config({ desfecho: "concluido" })],
      ]),
    );
    expect(grafo.edges).toHaveLength(2);
    expect(descartes.some((d) => d.motivo.includes("não existe"))).toBe(true);
  });

  it("renomeia id repetido e reaponta as arestas", () => {
    const plano: PlanoDeFluxo = {
      blocos: [
        { id: "n1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
        { id: "n1", tipo: "logic.end", rotulo: "Fim", intencao: "terminar" },
      ],
      ligacoes: [{ de: "n1", para: "n1" }],
    };
    const { grafo, valido, descartes } = planoParaGrafo(
      plano,
      new Map([["n1", config({})]]),
    );
    expect(valido).toBe(true);
    expect(new Set(grafo.nodes.map((n) => n.id)).size).toBe(2);
    expect(descartes.some((d) => d.motivo.includes("renomeado"))).toBe(true);
    // `analisarGrafo` acusaria `id_duplicado` — e o erro seria mostrado à pessoa
    // por uma falha que não foi dela.
    expect(analisarGrafo(grafo).erros).toEqual([]);
  });

  it("descarta bloco de tipo desconhecido", () => {
    const plano: PlanoDeFluxo = {
      blocos: [
        { id: "t1", tipo: "trigger.lead_created", rotulo: "Lead novo", intencao: "início" },
        { id: "x", tipo: "nao.existe", rotulo: "?", intencao: "?" },
      ],
      ligacoes: [{ de: "t1", para: "x" }],
    };
    const { grafo, descartes } = planoParaGrafo(plano, new Map([["t1", config({})]]));
    expect(grafo.nodes.map((n) => n.id)).toEqual(["t1"]);
    expect(grafo.edges).toEqual([]);
    expect(descartes.some((d) => d.motivo.includes("não conhece"))).toBe(true);
  });

  it("plano em que NADA sobrevive é declarado inválido, não devolvido vazio", () => {
    const plano: PlanoDeFluxo = {
      blocos: [{ id: "x", tipo: "nao.existe", rotulo: "?", intencao: "?" }],
      ligacoes: [],
    };
    const { valido, descartes } = planoParaGrafo(plano, new Map());
    expect(valido).toBe(false);
    expect(descartes.length).toBeGreaterThan(0);
  });
});
