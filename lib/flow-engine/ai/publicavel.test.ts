/**
 * O laço de correção: barato quando dá, e nunca pior do que não ter laço.
 *
 * A porta é falsa em todos os casos — o valor do laço é justamente que a maior
 * parte dele é determinística e não precisa de provedor para ser provada.
 */
import { describe, expect, it, vi } from "vitest";

import { tornarPublicavel } from "./publicavel";
import type { PortaDeModelo } from "./modelo-com-fallback";
import type { PlanoDeFluxo } from "./plan-schema";
import type { ConfigResolvida } from "./plan-to-graph";
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
  return { id: `${source}_${target}_${branch_id}`, source, target, branch_id };
}

const SEM_CONFIGS = new Map<string, ConfigResolvida>();

const PLANO_QUALQUER: PlanoDeFluxo = {
  blocos: [
    { id: "t", tipo: "trigger.lead_created", rotulo: "Início", intencao: "lead novo" },
    { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "acaba" },
  ],
  ligacoes: [{ de: "t", para: "fim" }],
};

function portaFalsa(objeto: unknown | null): PortaDeModelo {
  return {
    objeto: vi.fn(async () =>
      objeto === null
        ? {
            ok: false,
            causa: "o provedor recusou",
            avisos: [],
            tokensEntrada: null,
            tokensSaida: null,
            modeloUsado: "falso",
            usouReserva: false,
          }
        : {
            ok: true,
            objeto,
            avisos: [],
            tokensEntrada: 10,
            tokensSaida: 20,
            modeloUsado: "falso",
            usouReserva: false,
          },
    ) as PortaDeModelo["objeto"],
  };
}

describe("degrau 1: o fluxo já publica", () => {
  it("não gasta chamada nenhuma", async () => {
    const grafo: FlowGraph = {
      nodes: [no("t", "trigger.lead_created"), no("fim", "logic.end")],
      edges: [aresta("t", "fim")],
    };
    const porta = portaFalsa(null);

    const r = await tornarPublicavel({ porta, plano: PLANO_QUALQUER, configs: SEM_CONFIGS, grafo });

    expect(r.chamadas).toBe(0);
    expect(r.pendencias).toEqual([]);
    expect(porta.objeto).not.toHaveBeenCalled();
  });
});

describe("degrau 2: o reparo resolve sozinho", () => {
  it("conserta a saída solta sem chamar o modelo", async () => {
    const grafo: FlowGraph = {
      nodes: [no("t", "trigger.lead_created"), no("decide", "logic.if"), no("fim", "logic.end")],
      edges: [aresta("t", "decide"), aresta("decide", "fim")],
    };
    const porta = portaFalsa(null);

    const r = await tornarPublicavel({ porta, plano: PLANO_QUALQUER, configs: SEM_CONFIGS, grafo });

    expect(r.chamadas).toBe(0);
    expect(r.corrigidoPeloModelo).toBe(false);
    expect(r.consertos.length).toBeGreaterThan(0);
    expect(r.pendencias).toEqual([]);
    expect(validarParaPublicar(r.grafo).ok).toBe(true);
    expect(porta.objeto).not.toHaveBeenCalled();
  });
});

describe("degrau 3: a correção pelo modelo", () => {
  // Dois gatilhos: o reparo determinístico não escolhe qual fica (é intenção),
  // então este é exatamente o caso que sobra para o modelo.
  const doisGatilhos: FlowGraph = {
    nodes: [
      no("t", "trigger.lead_created"),
      no("t2", "trigger.message_received"),
      no("fim", "logic.end"),
    ],
    edges: [aresta("t", "fim"), aresta("t2", "fim")],
  };

  it("entra quando melhora, e o resultado publica", async () => {
    const porta = portaFalsa({
      blocos: [
        { id: "t", tipo: "trigger.lead_created", rotulo: "Início", intencao: "lead novo" },
        { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "acaba" },
      ],
      ligacoes: [{ de: "t", para: "fim" }],
    });

    const r = await tornarPublicavel({
      porta,
      plano: PLANO_QUALQUER,
      configs: SEM_CONFIGS,
      grafo: doisGatilhos,
    });

    expect(r.chamadas).toBe(1);
    expect(r.corrigidoPeloModelo).toBe(true);
    expect(r.pendencias).toEqual([]);
    expect(validarParaPublicar(r.grafo).ok).toBe(true);
  });

  it("recebe os erros escritos, não um pedido genérico", async () => {
    const porta = portaFalsa(null);

    await tornarPublicavel({
      porta,
      plano: PLANO_QUALQUER,
      configs: SEM_CONFIGS,
      grafo: doisGatilhos,
    });

    const pedido = (porta.objeto as unknown as { mock: { calls: [{ system: string }][] } }).mock
      .calls[0]![0];
    expect(pedido.system).toContain("blocos de início");
  });

  it("NÃO entra quando pioraria — o grafo reparado sobrevive", async () => {
    // A "correção" devolve um plano com os mesmos dois gatilhos: um erro
    // continua sendo um erro, e trocar seis por meia dúzia não vale a troca.
    const porta = portaFalsa({
      blocos: [
        { id: "t", tipo: "trigger.lead_created", rotulo: "A", intencao: "x" },
        { id: "t2", tipo: "trigger.keyword", rotulo: "B", intencao: "y" },
        { id: "fim", tipo: "logic.end", rotulo: "Fim", intencao: "acaba" },
      ],
      ligacoes: [
        { de: "t", para: "fim" },
        { de: "t2", para: "fim" },
      ],
    });

    const r = await tornarPublicavel({
      porta,
      plano: PLANO_QUALQUER,
      configs: SEM_CONFIGS,
      grafo: doisGatilhos,
    });

    expect(r.chamadas).toBe(1);
    expect(r.corrigidoPeloModelo).toBe(false);
    expect(r.grafo.nodes.map((n) => n.id)).toContain("t2");
    expect(r.pendencias.length).toBeGreaterThan(0);
  });

  it("modelo indisponível não apaga o trabalho — devolve com as pendências", async () => {
    const porta = portaFalsa(null);

    const r = await tornarPublicavel({
      porta,
      plano: PLANO_QUALQUER,
      configs: SEM_CONFIGS,
      grafo: doisGatilhos,
    });

    expect(r.corrigidoPeloModelo).toBe(false);
    expect(r.grafo.nodes.length).toBe(3);
    expect(r.pendencias.some((p) => p.codigo === "gatilho_repetido")).toBe(true);
  });

  it("cancelamento não paga chamada", async () => {
    const controle = new AbortController();
    controle.abort();
    const porta = portaFalsa(null);

    const r = await tornarPublicavel({
      porta,
      plano: PLANO_QUALQUER,
      configs: SEM_CONFIGS,
      grafo: doisGatilhos,
      sinal: controle.signal,
    });

    expect(r.chamadas).toBe(0);
    expect(porta.objeto).not.toHaveBeenCalled();
  });
});
