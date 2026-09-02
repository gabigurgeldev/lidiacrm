/**
 * O PARALELO ponta a ponta: motor + frentes + blocos reais, sobre o mundo falso.
 *
 * `frentes.test.ts` prova a aritmética; este arquivo prova a LIGAÇÃO — que o
 * motor abre as frentes que a aritmética manda abrir, que o merge só deixa
 * passar quem deve, que a corrida cancela o perdedor de verdade, e que o laço
 * repete o corpo o número de vezes que declarou.
 *
 * A diferença importa porque os três piores defeitos do paralelo não estão na
 * conta, estão na costura: contar certo e criar a frente errada dá o mesmo
 * resultado silencioso que contar errado.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { limparRegistroParaTeste } from "./registry";
import { criarMundoDeTeste, type MundoDeTeste } from "./teste/mundo";

const pos = { x: 0, y: 0 };
const n = (id: string, type: string, config: unknown) => ({
  id,
  type,
  label: id,
  position: pos,
  config,
});
const a = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

/** Bifurca em dois, marca uma tag em cada ramo, e reencontra. */
function grafoComFork(modo: "todas" | "primeira"): FlowGraph {
  return {
    nodes: [
      n("inicio", "trigger.lead_created", {}),
      n("bifurca", "logic.fork", {
        ramos: [
          { id: "esquerda", label: "Esquerda" },
          { id: "direita", label: "Direita" },
        ],
        modo,
        encontro: "junta",
      }),
      n("marca_esq", "crm.add_tag", { tag: "esquerda" }),
      n("marca_dir", "crm.add_tag", { tag: "direita" }),
      n("junta", "logic.merge", {}),
      n("fim", "logic.end", { desfecho: "juntou" }),
    ],
    edges: [
      a("e1", "inicio", "bifurca"),
      a("e2", "bifurca", "marca_esq", "esquerda"),
      a("e3", "bifurca", "marca_dir", "direita"),
      a("e4", "marca_esq", "junta"),
      a("e5", "marca_dir", "junta"),
      a("e6", "junta", "fim"),
    ],
  };
}

let mundo: MundoDeTeste;

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = criarMundoDeTeste();
});

describe("bifurcar e reencontrar", () => {
  it("um fork de dois ramos executa OS DOIS, e não só o primeiro", async () => {
    // O defeito que este caso barra é o mais fácil de não notar: um motor que
    // abre as frentes mas caminha só a primeira entrega um fluxo que parece
    // funcionar — o ramo da esquerda acontece, e o da direita simplesmente não,
    // sem erro nenhum.
    await rodarTickDeFluxos(mundo.montar(grafoComFork("todas")));
    await rodarTickDeFluxos(mundo.montar(grafoComFork("todas")));

    expect(mundo.tags.sort()).toEqual(["direita", "esquerda"]);
  });

  it("em modo TODAS, o merge só passa quando as duas frentes chegam", async () => {
    await rodarTickDeFluxos(mundo.montar(grafoComFork("todas")));
    await rodarTickDeFluxos(mundo.montar(grafoComFork("todas")));

    const encontro = mundo.encontros.get("exec-1:bifurca");
    expect(encontro).toMatchObject({ modo: "todas", esperadas: 2, chegadas: 2 });
    expect(encontro!.resolvido_em).not.toBeNull();

    // E o fluxo passou UMA vez pelo fim, não duas: duas frentes saindo do mesmo
    // merge refariam o fan-out sem ninguém ter pedido.
    const fins = mundo.passos.filter((p) => p.node_id === "fim" && p.event_type === "frente_concluiu");
    expect(fins).toHaveLength(1);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("`esperadas` conta DESTINOS: ramo do fork sem aresta não vira frente", async () => {
    // Se o ramo solto virasse frente, `esperadas` seria 2, só uma chegaria, e o
    // merge em modo `todas` esperaria para sempre. Fluxo travado, sem erro, sem
    // log — o modo de falha mais caro que este motor pode ter.
    const grafo = grafoComFork("todas");
    grafo.edges = grafo.edges.filter((e) => e.id !== "e3"); // a direita fica solta

    await rodarTickDeFluxos(mundo.montar(grafo));
    await rodarTickDeFluxos(mundo.montar(grafo));

    expect(mundo.encontros.get("exec-1:bifurca")).toMatchObject({ esperadas: 1, chegadas: 1 });
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("em modo PRIMEIRA, quem chega antes vence e a irmã que DORMIA é cancelada", async () => {
    // A corrida de verdade do produto: "o cliente responde OU 24h passam". O
    // perdedor não é um ramo que já correu — é um ramo AINDA PARADO, esperando.
    // Sem o cancelamento ele acorda depois e segue, e a cobrança automática sai
    // logo após a pessoa ter dito que ia pagar.
    const grafo: FlowGraph = {
      nodes: [
        n("inicio", "trigger.lead_created", {}),
        n("bifurca", "logic.fork", {
          ramos: [
            { id: "rapido", label: "Respondeu" },
            { id: "lento", label: "Deu o prazo" },
          ],
          modo: "primeira",
          encontro: "junta",
        }),
        n("espera", "logic.wait", { duracao_ms: 24 * 60 * 60_000 }),
        n("junta", "logic.merge", {}),
        n("fim", "logic.end", { desfecho: "alguem_venceu" }),
      ],
      edges: [
        a("e1", "inicio", "bifurca"),
        a("e2", "bifurca", "junta", "rapido"),
        a("e3", "bifurca", "espera", "lento"),
        a("e4", "espera", "junta"),
        a("e5", "junta", "fim"),
      ],
    };

    // Dois ticks: o primeiro ABRE as frentes e devolve o controle; é no segundo
    // que elas caminham e a corrida acontece.
    await rodarTickDeFluxos(mundo.montar(grafo));
    await rodarTickDeFluxos(mundo.montar(grafo));

    const filhas = [...mundo.frentes.values()].filter((f) => f.fork_node_id === "bifurca");
    expect(filhas).toHaveLength(2);

    const perdedora = filhas.find((f) => f.node_id === "espera")!;
    expect(perdedora.status).toBe("cancelled");
    // A cancelada NÃO tem relógio: com um, o claim a traria de volta daqui a 24h
    // para andar depois de já ter perdido.
    expect(perdedora.next_eval_at).toBeNull();
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("a irmã cancelada no MEIO do tick não caminha mais nessa mesma rodada", async () => {
    // ⚠️ Defeito medido: as frentes do tick são lidas de uma vez, e a corrida
    // cancela as irmãs no meio dessa lista. Sem reler antes de caminhar, a
    // perdedora — já cancelada no banco — seguia andando na MESMA rodada e
    // executava os blocos do ramo que acabara de perder.
    const grafo: FlowGraph = {
      nodes: [
        n("inicio", "trigger.lead_created", {}),
        n("bifurca", "logic.fork", {
          ramos: [
            { id: "rapido", label: "Rápido" },
            { id: "lento", label: "Lento" },
          ],
          modo: "primeira",
          encontro: "junta",
        }),
        n("cobra", "crm.add_tag", { tag: "cobrado" }),
        n("junta", "logic.merge", {}),
        n("fim", "logic.end", { desfecho: "venceu" }),
      ],
      edges: [
        a("e1", "inicio", "bifurca"),
        a("e2", "bifurca", "junta", "rapido"),
        a("e3", "bifurca", "cobra", "lento"),
        a("e4", "cobra", "junta"),
        a("e5", "junta", "fim"),
      ],
    };

    await rodarTickDeFluxos(mundo.montar(grafo));
    await rodarTickDeFluxos(mundo.montar(grafo));

    // O ramo perdedor NÃO marcou o lead: ele foi cancelado antes de andar.
    expect(mundo.tags).toEqual([]);
  });

  it("dois ramos gravando a MESMA variável não se sobrescrevem", async () => {
    // O defeito silencioso nº 1 do paralelo. No espaço compartilhado, o valor
    // final seria o de quem terminou por último — sem erro, com o fluxo seguindo
    // e entregando o resultado errado.
    const grafo = grafoComFork("todas");
    await rodarTickDeFluxos(mundo.montar(grafo));

    const filhas = [...mundo.frentes.values()].filter((f) => f.fork_node_id === "bifurca");
    expect(filhas).toHaveLength(2);
    filhas[0]!.vars.escolha = "esquerda";
    filhas[1]!.vars.escolha = "direita";

    await rodarTickDeFluxos(mundo.montar(grafo));

    // Nenhuma escrita local vazou para o espaço compartilhado da execução.
    expect(mundo.execucoes.get("exec-1")!.context.escolha).toBeUndefined();
  });
});

describe("o laço", () => {
  function grafoComLaco(max: number): FlowGraph {
    return {
      nodes: [
        n("inicio", "trigger.lead_created", {}),
        n("repete", "logic.loop", { lista: "global.itens", max }),
        n("marca", "crm.add_tag", { tag: "voltou" }),
        n("fim", "logic.end", { desfecho: "percorreu" }),
      ],
      edges: [
        a("e1", "inicio", "repete"),
        a("e2", "repete", "marca", "corpo"),
        a("e3", "marca", "repete"),
        a("e4", "repete", "fim", "else"),
      ],
    };
  }

  it("percorre a lista item a item e sai pelo fim", async () => {
    mundo.globais = { itens: ["a", "b", "c"] };
    await rodarTickDeFluxos(mundo.montar(grafoComLaco(10)));

    expect(mundo.tags).toEqual(["voltou", "voltou", "voltou"]);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("o TETO corta a lista, e é por isso que o ciclo pode existir", async () => {
    // A validação de publicação proíbe qualquer ciclo porque um ciclo sem teto
    // queima `steps_taken` até a execução morrer. Com teto, o ciclo tem fim
    // conhecido antes de começar.
    mundo.globais = { itens: ["a", "b", "c", "d", "e"] };
    await rodarTickDeFluxos(mundo.montar(grafoComLaco(2)));

    expect(mundo.tags).toEqual(["voltou", "voltou"]);
  });

  it("lista vazia sai direto pelo fim, sem rodar o corpo", async () => {
    mundo.globais = { itens: [] };
    await rodarTickDeFluxos(mundo.montar(grafoComLaco(10)));

    expect(mundo.tags).toEqual([]);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("campo que NÃO é lista percorre zero vezes, em vez de virar caracteres", async () => {
    // Percorrer um texto daria um laço rodando 27 vezes sobre um nome próprio.
    mundo.globais = { itens: "Gabriel" };
    await rodarTickDeFluxos(mundo.montar(grafoComLaco(10)));

    expect(mundo.tags).toEqual([]);
  });
});

describe("esperar um evento", () => {
  const UMA_HORA = 60 * 60_000;

  function grafoComEspera(): FlowGraph {
    return {
      nodes: [
        n("inicio", "trigger.lead_created", {}),
        n("aguarda", "logic.await_event", {
          evento: "message.received",
          quando: {},
          prazo_ms: UMA_HORA,
        }),
        n("respondeu", "crm.add_tag", { tag: "respondeu" }),
        n("silencio", "crm.add_tag", { tag: "silencio" }),
        n("fim", "logic.end", { desfecho: "fim" }),
      ],
      edges: [
        a("e1", "inicio", "aguarda"),
        a("e2", "aguarda", "respondeu", "chegou"),
        a("e3", "aguarda", "silencio", "else"),
        a("e4", "respondeu", "fim"),
        a("e5", "silencio", "fim"),
      ],
    };
  }

  it("dorme com o prazo no relógio da frente, sem seguir por ramo nenhum", async () => {
    await rodarTickDeFluxos(mundo.montar(grafoComEspera()));

    const frente = [...mundo.frentes.values()][0]!;
    expect(frente.status).toBe("waiting");
    expect(frente.awaiting_event_type).toBe("message.received");
    expect(frente.wait_deadline).toBe(new Date(mundo.agora.getTime() + UMA_HORA).toISOString());
    expect(mundo.tags).toEqual([]);
  });

  it("vencido o prazo, sai pelo ramo do prazo — e NÃO dorme outro prazo", async () => {
    // ⚠️ Sem isto, `logic.await_event` é um laço infinito silencioso: o prazo
    // vence, o claim traz a frente de volta, o nó roda de novo e devolve um
    // prazo NOVO. A frente dorme para sempre e o ramo "venceu o prazo" que o
    // operador desenhou nunca é percorrido.
    await rodarTickDeFluxos(mundo.montar(grafoComEspera()));

    mundo.avancarPara(new Date(mundo.agora.getTime() + UMA_HORA + 1000));
    await rodarTickDeFluxos(mundo.montar(grafoComEspera()));

    expect(mundo.tags).toEqual(["silencio"]);
    expect(mundo.execucoes.get("exec-1")!.status).toBe("completed");
  });

  it("depois de vencer o prazo, a frente para de esperar o evento", async () => {
    // Manter `awaiting_event_type` faria um evento atrasado acordar uma frente
    // que já seguiu pelo prazo — o fluxo tomaria os dois caminhos.
    await rodarTickDeFluxos(mundo.montar(grafoComEspera()));
    mundo.avancarPara(new Date(mundo.agora.getTime() + UMA_HORA + 1000));
    await rodarTickDeFluxos(mundo.montar(grafoComEspera()));

    const frente = [...mundo.frentes.values()][0]!;
    expect(frente.awaiting_event_type).toBeNull();
    expect(frente.wait_deadline).toBeNull();
  });
});
