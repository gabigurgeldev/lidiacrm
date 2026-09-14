/**
 * MARCAR e DESMARCAR sobre o motor de verdade.
 *
 * O caso que este arquivo existe para travar é o do fluxo SEM LEAD: o bloco
 * respondia `dead`, não marcava ninguém, não avançava, e a execução morria sem
 * uma linha na tela. Como todo fluxo armado por mensagem de WhatsApp nasce sem
 * lead, isso era o caminho mais usado do produto.
 *
 * Mede-se pelo motor (e não chamando `execute` na mão) porque metade da queixa
 * era "não passa pra frente": só o motor responde se a aresta foi seguida.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "../engine";
import type { FlowGraph } from "../graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "../register-all";
import { limparRegistroParaTeste } from "../registry";
import { criarMundoDeTeste, type MundoDeTeste } from "../teste/mundo";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({
  id,
  type,
  label: id,
  position: pos,
  config,
});
const aresta = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

let mundo: MundoDeTeste;

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = criarMundoDeTeste();
});

/**
 * Marca e, DEPOIS, marca de novo com outro marcador. O segundo é a prova de que
 * o fluxo andou: se o bloco não avançasse, `depois` nunca chegaria a rodar.
 */
function grafoQueMarcaDuasVezes(): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("marca", "crm.add_tag", { tag: "vip" }),
      no("depois", "crm.add_tag", { tag: "andou" }),
    ],
    edges: [aresta("e1", "inicio", "marca"), aresta("e2", "marca", "depois")],
  };
}

async function rodarAteParar(grafo: FlowGraph, voltas = 6): Promise<void> {
  for (let i = 0; i < voltas; i += 1) {
    await rodarTickDeFluxos(mundo.montar(grafo));
  }
}

describe("marcar o cliente", () => {
  it("⭐ com lead: marca o LEAD e segue para o bloco seguinte", async () => {
    await rodarAteParar(grafoQueMarcaDuasVezes());

    expect(mundo.tags).toEqual(["vip", "andou"]);
    expect(mundo.tagsDoContato).toEqual([]);
  });

  it("⭐ SEM LEAD: marca o CONTATO e segue igual — era onde morria calado", async () => {
    mundo.semLead = true;

    await rodarAteParar(grafoQueMarcaDuasVezes());

    expect(mundo.tagsDoContato).toEqual(["vip", "andou"]);
    expect(mundo.tags).toEqual([]);
    // E a execução chegou ao fim em vez de virar `dead`.
    const status = [...mundo.execucoes.values()].map((e) => e.status);
    expect(status).not.toContain("dead");
  });

  it("marcar duas vezes o mesmo marcador não duplica", async () => {
    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("a", "crm.add_tag", { tag: "vip" }),
        no("b", "crm.add_tag", { tag: "vip" }),
      ],
      edges: [aresta("e1", "inicio", "a"), aresta("e2", "a", "b")],
    };

    await rodarAteParar(grafo);

    expect(mundo.tags).toEqual(["vip"]);
  });

  it("⭐ sem lead e sem contato: sai pela exceção com o motivo, e não mata a execução", async () => {
    mundo.semLead = true;
    mundo.semContato = true;

    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("marca", "crm.add_tag", { tag: "vip" }),
        no("socorro", "crm.add_tag", { tag: "nao-deu" }),
      ],
      edges: [
        aresta("e1", "inicio", "marca"),
        aresta("e2", "marca", "socorro", "nao_marcou"),
      ],
    };

    await rodarAteParar(grafo);

    const avancos = mundo.passos.filter((p) => p.node_id === "marca");
    expect(avancos.at(-1)?.payload.ramo).toBe("nao_marcou");
    // O motivo chega à trilha — é o que faltava para a falha ser legível.
    expect(avancos.at(-1)?.payload.marcacao_recusada).toBe("sem_alvo");
  });
});

describe("desmarcar o cliente", () => {
  it("⭐ tira o marcador que existe e segue", async () => {
    mundo.tags.push("vip", "fica");

    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("tira", "crm.remove_tag", { tag: "vip" }),
        no("depois", "crm.add_tag", { tag: "andou" }),
      ],
      edges: [aresta("e1", "inicio", "tira"), aresta("e2", "tira", "depois")],
    };

    await rodarAteParar(grafo);

    expect(mundo.tags).toEqual(["fica", "andou"]);
  });

  it("⭐ tirar o que não está lá NÃO é erro: o fluxo segue igual", async () => {
    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("tira", "crm.remove_tag", { tag: "nunca-teve" }),
        no("depois", "crm.add_tag", { tag: "andou" }),
      ],
      edges: [aresta("e1", "inicio", "tira"), aresta("e2", "tira", "depois")],
    };

    await rodarAteParar(grafo);

    expect(mundo.tags).toEqual(["andou"]);
  });

  it("⭐ desmarca o CONTATO quando o fluxo não tem lead", async () => {
    mundo.semLead = true;
    mundo.tagsDoContato.push("vip");

    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("tira", "crm.remove_tag", { tag: "vip" }),
      ],
      edges: [aresta("e1", "inicio", "tira")],
    };

    await rodarAteParar(grafo);

    expect(mundo.tagsDoContato).toEqual([]);
  });
});

describe("decidir logo depois de marcar", () => {
  it("⭐ o Decidir vê a marcação que o bloco anterior acabou de fazer", async () => {
    // `mutaCrm` é o que garante isto: sem ele, os fatos do tick seriam os de
    // antes da marcação e o Decidir sairia pelo "Nenhuma delas" — marcado e
    // ignorado no mesmo fluxo.
    mundo.semLead = true;

    const grafo: FlowGraph = {
      nodes: [
        no("inicio", "trigger.lead_created", {}),
        no("marca", "crm.add_tag", { tag: "vip" }),
        no("decide", "logic.if", {
          saidas: [
            {
              id: "s_vip",
              label: "É VIP",
              quando: {
                combinador: "or",
                itens: [
                  { campo: "lead.tags", op: "contains", valor: "vip" },
                  { campo: "contact.tags", op: "contains", valor: "vip" },
                ],
              },
            },
          ],
        }),
        no("fim_vip", "crm.add_tag", { tag: "foi-pelo-vip" }),
        no("fim_outro", "crm.add_tag", { tag: "foi-pelo-senao" }),
      ],
      edges: [
        aresta("e1", "inicio", "marca"),
        aresta("e2", "marca", "decide"),
        aresta("e3", "decide", "fim_vip", "s_vip"),
        aresta("e4", "decide", "fim_outro", "else"),
      ],
    };

    await rodarAteParar(grafo);

    expect(mundo.tagsDoContato).toEqual(["vip", "foi-pelo-vip"]);
  });
});
