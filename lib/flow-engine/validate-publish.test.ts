import { beforeEach, describe, expect, it } from "vitest";

import { analisarGrafo, flowGraphSchema, type FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste, tiposRegistrados } from "./registry";
import { validarParaPublicar } from "./validate-publish";

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
});

const pos = { x: 0, y: 0 };

function no(id: string, type: string, config: unknown = {}) {
  return { id, type, label: id, position: pos, config };
}
function aresta(id: string, source: string, target: string, branch_id = "else") {
  return { id, source, target, branch_id };
}

const SE_SCORE_ALTO = {
  saidas: [
    {
      id: "alto",
      label: "Score acima de 70",
      quando: { combinador: "and" as const, itens: [{ campo: "lead.score", op: "gt" as const, valor: 70 }] },
    },
  ],
};

/** O grafo mínimo que publica: início, decisão com as duas saídas ligadas, fins. */
function grafoBom(): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.lead_created"),
      no("decide", "logic.if", SE_SCORE_ALTO),
      no("fim_alto", "logic.end", { desfecho: "qualificado" }),
      no("fim_baixo", "logic.end", { desfecho: "descartado" }),
    ],
    edges: [
      aresta("e1", "inicio", "decide"),
      aresta("e2", "decide", "fim_alto", "alto"),
      aresta("e3", "decide", "fim_baixo", "else"),
    ],
  };
}

describe("o registry decide o que existe", () => {
  it("os 18 nós desta entrega estão registrados", () => {
    expect(tiposRegistrados()).toEqual([
      "crm.add_tag",
      "crm.assign_owner",
      "crm.owner_responded",
      "flow.call",
      "logic.await_event",
      "logic.end",
      "logic.fork",
      "logic.if",
      "logic.loop",
      "logic.merge",
      "logic.wait",
      "notify.internal",
      "routing.redistribute",
      "routing.round_robin",
      "trigger.lead_created",
      "whatsapp.bulk_send",
      "whatsapp.notify_user",
      "whatsapp.send_to_lead",
    ]);
  });

  it("tipo fora do registry é erro ancorado no bloco, não exceção", () => {
    const g = grafoBom();
    g.nodes.push(no("estranho", "coisa.que.nao.existe"));
    const r = analisarGrafo(g);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ ancora: "estranho", codigo: "tipo_desconhecido" });
  });

  it("config que não bate com o schema do nó é erro ancorado", () => {
    const g = grafoBom();
    g.nodes[1] = no("decide", "logic.if", { saidas: [] });
    const r = analisarGrafo(g);
    expect(r.erros[0]).toMatchObject({ ancora: "decide", codigo: "config_invalida" });
  });

  it("as saídas do logic.if saem da config, não de uma lista fixa", () => {
    const g = grafoBom();
    const r = analisarGrafo(g);
    const decide = r.nos.find((n) => n.id === "decide")!;
    expect(decide.branches.map((b) => b.id)).toEqual(["alto", "else"]);
    expect(decide.branches.map((b) => b.kind)).toEqual(["match", "fallback"]);
  });
});

describe("validarParaPublicar", () => {
  it("aprova o grafo mínimo", () => {
    const r = validarParaPublicar(grafoBom());
    expect(r.erros).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("recusa fluxo sem bloco de início", () => {
    const g = grafoBom();
    g.nodes = g.nodes.filter((n) => n.id !== "inicio");
    g.edges = g.edges.filter((e) => e.source !== "inicio");
    const r = validarParaPublicar(g);
    expect(r.ok).toBe(false);
    expect(r.erros.map((e) => e.codigo)).toContain("sem_gatilho");
  });

  it("recusa dois blocos de início", () => {
    const g = grafoBom();
    g.nodes.push(no("inicio2", "trigger.lead_created"));
    g.edges.push(aresta("e4", "inicio2", "decide"));
    const r = validarParaPublicar(g);
    expect(r.erros.map((e) => e.codigo)).toContain("gatilho_repetido");
  });

  it("recusa saída de REGRA sem ligação, e aceita pega-tudo solto", () => {
    const semRamo = grafoBom();
    semRamo.edges = semRamo.edges.filter((e) => e.branch_id !== "alto");
    expect(validarParaPublicar(semRamo).erros.map((e) => e.codigo)).toContain("ramo_sem_saida");

    // O pega-tudo solto significa "termina aqui" — desenho legítimo.
    const semSenao = grafoBom();
    semSenao.nodes = semSenao.nodes.filter((n) => n.id !== "fim_baixo");
    semSenao.edges = semSenao.edges.filter((e) => e.target !== "fim_baixo");
    const r = validarParaPublicar(semSenao);
    expect(r.erros).toEqual([]);
  });

  it("recusa ligação presa a uma saída que não existe mais", () => {
    // O caso real: o operador apaga uma regra do `logic.if` e a aresta fica órfã.
    const g = grafoBom();
    g.edges[1] = aresta("e2", "decide", "fim_alto", "ramo_apagado");
    const r = validarParaPublicar(g);
    expect(r.erros.map((e) => e.codigo)).toContain("ramo_inexistente");
  });

  it("recusa ligação para bloco inexistente", () => {
    const g = grafoBom();
    g.edges.push(aresta("e9", "fim_alto", "fantasma"));
    expect(validarParaPublicar(g).erros.map((e) => e.codigo)).toContain("destino_inexistente");
  });

  it("recusa qualquer volta ao bloco de início", () => {
    const g = grafoBom();
    g.edges.push(aresta("e9", "fim_alto", "inicio"));
    expect(validarParaPublicar(g).erros.map((e) => e.codigo)).toContain("volta_ao_inicio");
  });

  it("recusa ciclo", () => {
    const g: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created"),
        no("a", "crm.add_tag", { tag: "x" }),
        no("b", "crm.add_tag", { tag: "y" }),
      ],
      edges: [aresta("e1", "inicio", "a"), aresta("e2", "a", "b"), aresta("e3", "b", "a")],
    };
    expect(validarParaPublicar(g).erros.map((e) => e.codigo)).toContain("ciclo");
  });

  it("ciclo longo não estoura a pilha", () => {
    const nodes = [no("inicio", "trigger.lead_created")];
    const edges = [aresta("e0", "inicio", "n0")];
    for (let i = 0; i < 150; i += 1) {
      nodes.push(no(`n${i}`, "crm.add_tag", { tag: `t${i}` }));
      edges.push(aresta(`e${i + 1}`, `n${i}`, i === 149 ? "n0" : `n${i + 1}`));
    }
    const g: FlowGraph = { nodes, edges };
    expect(() => validarParaPublicar(g)).not.toThrow();
    expect(validarParaPublicar(g).erros.map((e) => e.codigo)).toContain("ciclo");
  });

  it("bloco inalcançável é AVISO, não erro", () => {
    const g = grafoBom();
    g.nodes.push(no("orfao", "crm.add_tag", { tag: "solta" }));
    const r = validarParaPublicar(g);
    expect(r.ok).toBe(true);
    expect(r.avisos.map((a) => a.codigo)).toContain("inalcancavel");
  });

  it("id de bloco repetido é erro", () => {
    const g = grafoBom();
    g.nodes.push(no("decide", "logic.end", { desfecho: "outro" }));
    expect(validarParaPublicar(g).erros.map((e) => e.codigo)).toContain("id_duplicado");
  });
});

describe("o schema de forma", () => {
  it("recusa grafo sem nós", () => {
    expect(flowGraphSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
  });

  it("aceita config opaca — quem valida o conteúdo é o passe 2", () => {
    const r = flowGraphSchema.safeParse({
      nodes: [{ id: "a", type: "qualquer.coisa", label: "A", position: pos, config: { livre: true } }],
      edges: [],
    });
    expect(r.success).toBe(true);
  });
});

describe("o paralelo, no portão da publicação", () => {
  /** Bifurca em dois e reencontra. O desenho que a doutrina do fork exige. */
  function grafoComFork(over: { encontro?: string } = {}): FlowGraph {
    return {
      nodes: [
        no("inicio", "trigger.lead_created"),
        no("bifurca", "logic.fork", {
          ramos: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          modo: "todas",
          encontro: over.encontro ?? "junta",
        }),
        no("marca_a", "crm.add_tag", { tag: "a" }),
        no("marca_b", "crm.add_tag", { tag: "b" }),
        no("junta", "logic.merge"),
        no("fim", "logic.end", { desfecho: "ok" }),
      ],
      edges: [
        aresta("e1", "inicio", "bifurca"),
        aresta("e2", "bifurca", "marca_a", "a"),
        aresta("e3", "bifurca", "marca_b", "b"),
        aresta("e4", "marca_a", "junta"),
        aresta("e5", "marca_b", "junta"),
        aresta("e6", "junta", "fim"),
      ],
    };
  }

  it("um fluxo que bifurca e reencontra PUBLICA", () => {
    expect(validarParaPublicar(grafoComFork()).ok).toBe(true);
  });

  it("reencontro que não existe no grafo é ERRO", () => {
    // `encontro` é declarado pelo fork, não descoberto pelo motor. O preço de
    // declarar é alguém conferir: sem isto, o defeito aparece só em runtime,
    // como um fluxo que bifurca e nunca mais se junta — e o motor não distingue
    // isso de um fluxo que termina em ramos separados de propósito.
    const r = validarParaPublicar(grafoComFork({ encontro: "nao_existe" }));
    expect(r.ok).toBe(false);
    expect(r.erros.map((e) => e.codigo)).toContain("encontro_inexistente");
  });

  it("reencontro que aponta para um bloco que NÃO é reencontro é ERRO", () => {
    const r = validarParaPublicar(grafoComFork({ encontro: "marca_a" }));
    expect(r.ok).toBe(false);
    expect(r.erros.map((e) => e.codigo)).toContain("encontro_nao_e_reencontro");
  });

  it("um laço com contador PUBLICA, mesmo formando círculo", () => {
    // A regra antiga era "nenhum ciclo", e o motivo estava certo: ciclo sem fim
    // consome `steps_taken` até a execução morrer. `logic.loop` tem `max`
    // obrigatório, então o círculo que passa por ele tem fim conhecido antes de
    // começar — e sem isto o bloco de repetição não poderia ser publicado nunca.
    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created"),
        no("repete", "logic.loop", { lista: "vars.itens", max: 5 }),
        no("corpo", "crm.add_tag", { tag: "x" }),
        no("fim", "logic.end", { desfecho: "ok" }),
      ],
      edges: [
        aresta("e1", "inicio", "repete"),
        aresta("e2", "repete", "corpo", "corpo"),
        aresta("e3", "corpo", "repete"),
        aresta("e4", "repete", "fim", "else"),
      ],
    };
    expect(validarParaPublicar(grafo).ok).toBe(true);
  });

  it("círculo SEM contador segue sendo erro", () => {
    // A contra-prova do caso acima: se a regra tivesse sido simplesmente
    // removida para o laço caber, todo círculo passaria — e um fluxo que volta
    // ao mesmo bloco para sempre publica sem ninguém notar.
    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created"),
        no("marca", "crm.add_tag", { tag: "x" }),
        no("marca2", "crm.add_tag", { tag: "y" }),
      ],
      edges: [
        aresta("e1", "inicio", "marca"),
        aresta("e2", "marca", "marca2"),
        aresta("e3", "marca2", "marca"),
      ],
    };
    const r = validarParaPublicar(grafo);
    expect(r.ok).toBe(false);
    expect(r.erros.map((e) => e.codigo)).toContain("ciclo");
  });
});
