/**
 * OS BLOCOS DA TERCEIRA LEVA, sobre o motor de verdade.
 *
 * Gatilho por palavra, fila indiana, sorteio, entrega à IA e menu de escolha.
 * Cada `describe` protege o defeito que aquele bloco pode ter em silêncio — e
 * "em silêncio" é o adjetivo que importa: nenhum destes falha com erro. Eles
 * entregam ao vendedor errado, ou não entregam a ninguém, e o fluxo termina
 * dizendo que deu certo.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "./engine";
import type { FlowGraph } from "./graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "./register-all";
import { exigirNo, limparRegistroParaTeste } from "./registry";
import { criarMundoDeTeste, execucaoNova, type MundoDeTeste } from "./teste/mundo";

const pos = { x: 0, y: 0 };
const no = (id: string, type: string, config: unknown) => ({ id, type, label: id, position: pos, config });
const aresta = (id: string, source: string, target: string, branch_id = "else") => ({
  id,
  source,
  target,
  branch_id,
});

const ANA = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const BRUNO = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

let mundo: MundoDeTeste;

beforeEach(() => {
  limparRegistroParaTeste();
  esquecerRegistroParaTeste();
  garantirNosRegistrados();
  mundo = criarMundoDeTeste();
});

// ─────────────────────────── gatilho por palavra ─────────────────────────────

function grafoDeGatilho(config: Record<string, unknown>): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.keyword", config),
      no("marca", "crm.add_tag", { tag: "interessado" }),
    ],
    edges: [aresta("e1", "inicio", "marca")],
  };
}

describe("gatilho por palavra-chave", () => {
  it("⭐ a mensagem que NÃO tem a palavra não faz o fluxo andar", () => {
    // O bloco recebe toda mensagem (o matcher não lê config) e é ele quem
    // decide. Sem esta recusa, todo fluxo por palavra-chave rodaria em toda
    // mensagem da organização.
    const deps = mundo.montar(grafoDeGatilho({ palavras: ["orçamento"], modo: "contem" }));
    const exec = [...mundo.execucoes.values()][0]!;
    exec.input = { body: "bom dia, tudo bem?" };
    return rodarTickDeFluxos(deps).then(() => {
      expect(mundo.tags, "marcou o lead de uma mensagem que não pedia nada").toEqual([]);
    });
  });

  it("a mensagem com a palavra anda, e acento não atrapalha", async () => {
    const deps = mundo.montar(grafoDeGatilho({ palavras: ["orçamento"], modo: "contem" }));
    const exec = [...mundo.execucoes.values()][0]!;
    exec.input = { body: "queria um ORCAMENTO por favor" };
    await rodarTickDeFluxos(deps);
    expect(mundo.tags).toEqual(["interessado"]);
  });

  it("⭐ modo exato não deixa '10' escolher a opção '1'", async () => {
    const deps = mundo.montar(grafoDeGatilho({ palavras: ["1"], modo: "exata" }));
    const exec = [...mundo.execucoes.values()][0]!;
    exec.input = { body: "10 reais" };
    await rodarTickDeFluxos(deps);
    expect(mundo.tags).toEqual([]);
  });
});

// ───────────────────────────── fila indiana ──────────────────────────────────

function grafoDeFila(ordem: string[]): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("fila", "routing.fixed_order", {
        ordem,
        quando_ninguem: "seguir_pelo_senao",
        tentar_de_novo_em_ms: 300_000,
      }),
      no("fim", "logic.end", { desfecho: "entregue" }),
    ],
    edges: [aresta("e1", "inicio", "fila"), aresta("e2", "fila", "fim")],
  };
}

describe("fila indiana no motor", () => {
  it("⭐ leads seguidos vão para pessoas DIFERENTES, na ordem", async () => {
    // O defeito que este caso barra: um cursor por execução reiniciaria a cada
    // lead e entregaria sempre ao primeiro — a fila configurada viraria, na
    // prática, um vendedor fixo.
    mundo.elegiveis = [{ userId: ANA }, { userId: BRUNO }] as typeof mundo.elegiveis;

    // DOIS leads, e não dois tiques do mesmo: é entre execuções diferentes que
    // o cursor precisa sobreviver, e um tique a mais na mesma execução não
    // mede nada disso.
    await rodarTickDeFluxos(mundo.montar(grafoDeFila([ANA, BRUNO])));

    const segundo = execucaoNova();
    segundo.id = "exec-2";
    mundo.execucoes.set(segundo.id, segundo);
    await rodarTickDeFluxos(mundo.montar(grafoDeFila([ANA, BRUNO])));

    expect(mundo.atribuicoes.map((a) => a.userId)).toEqual([ANA, BRUNO]);
  });

  it("sem ninguém elegível, segue pela saída própria em vez de travar", async () => {
    mundo.elegiveis = [];
    await rodarTickDeFluxos(mundo.montar(grafoDeFila([ANA, BRUNO])));
    expect(mundo.atribuicoes).toHaveLength(0);
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status).not.toBe("failed");
  });
});

// ──────────────────────────── entregar para a IA ─────────────────────────────

describe("entregar a conversa para a IA", () => {
  const grafo: FlowGraph = {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("ia", "crm.handoff_to_agent", {}),
      no("fim", "logic.end", { desfecho: "entregue" }),
    ],
    edges: [aresta("e1", "inicio", "ia"), aresta("e2", "ia", "fim")],
  };

  it("devolve a conversa do contato ao agente", async () => {
    await rodarTickDeFluxos(mundo.montar(grafo));
    expect(mundo.devolvidasAoAgente).toEqual(["contato-1"]);
  });

  it("sem conversa, sai pela saída própria e não mata a execução", async () => {
    mundo.semConversaParaAgente = true;
    await rodarTickDeFluxos(mundo.montar(grafo));
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status).not.toBe("failed");
    expect(exec.context.ia_erro).toBe("sem_conversa");
  });
});

// ──────────────────────────── menu de escolha ────────────────────────────────

describe("menu de escolha", () => {
  const grafo: FlowGraph = {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("menu", "logic.choice_menu", {
        opcoes: [
          { id: "sim", label: "Sim", aceita: ["1", "sim"] },
          { id: "nao", label: "Não", aceita: ["2", "nao"] },
        ],
        modo: "exata",
        prazo_ms: 3_600_000,
      }),
      no("marcou_sim", "crm.add_tag", { tag: "quer" }),
      no("marcou_nao", "crm.add_tag", { tag: "nao_quer" }),
      no("nao_entendi", "crm.add_tag", { tag: "confuso" }),
    ],
    edges: [
      aresta("e1", "inicio", "menu"),
      aresta("e2", "menu", "marcou_sim", "sim"),
      aresta("e3", "menu", "marcou_nao", "nao"),
      aresta("e4", "menu", "nao_entendi", "else"),
    ],
  };

  it("⭐ o bloco DORME esperando resposta, em vez de seguir sozinho", async () => {
    // Seguir sozinho pelo pega-tudo faria o fluxo tratar todo cliente como
    // "não entendi" antes mesmo de ele ter tido chance de responder.
    await rodarTickDeFluxos(mundo.montar(grafo));
    expect(mundo.tags).toEqual([]);
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status).toBe("waiting");
  });

  it("as saídas do bloco são as opções, mais as duas de exceção", () => {
    // Direto do registry: a versão anterior deste caso chamava um método que o
    // mundo de teste não tem, e o `?? null` engolia isso — ele passava sem
    // afirmar nada. Controle contra o próprio teste.
    const menu = grafo.nodes.find((n) => n.id === "menu")!;
    const def = exigirNo(menu.type);
    const config = def.configSchema.parse(menu.config);
    const ramos = def.branches(config);
    // Duas exceções DIFERENTES de propósito: silêncio pede insistir, resposta
    // fora do menu pede repetir a pergunta de outro jeito.
    expect(ramos.map((r) => r.id)).toEqual(["sim", "nao", "nao_respondeu", "else"]);
  });
});
