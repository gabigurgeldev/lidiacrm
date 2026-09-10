/**
 * "Dividir os caminhos" SOBRE O MOTOR DE VERDADE.
 *
 * `divisao.test.ts` já mede a regra pura. O que só aparece aqui é a costura: o
 * ramo que o bloco escolhe vira a aresta que o motor segue, e o estado da fila
 * e do placar sobrevive de uma EXECUÇÃO para a outra — que é o defeito inteiro.
 * Um contador por execução faria os três modos mandarem tudo pelo primeiro
 * caminho, sem erro nenhum, com o fluxo terminando "concluído".
 */
import { beforeEach, describe, expect, it } from "vitest";

import { rodarTickDeFluxos } from "../engine";
import type { FlowGraph } from "../graph-schema";
import { esquecerRegistroParaTeste, garantirNosRegistrados } from "../register-all";
import { exigirNo, limparRegistroParaTeste } from "../registry";
import { criarMundoDeTeste, execucaoNova, type MundoDeTeste } from "../teste/mundo";

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
 * Dois caminhos, cada um marcando o lead com uma tag diferente. A tag é a
 * evidência OBSERVÁVEL de por onde a execução passou — mais honesta que ler o
 * `branch_id` de dentro, porque prova que o motor seguiu a aresta.
 */
function grafoDeDivisao(modo: string): FlowGraph {
  return {
    nodes: [
      no("inicio", "trigger.lead_created", {}),
      no("divide", "logic.split", {
        modo,
        caminhos: [
          { id: "cam_a", label: "Caminho A" },
          { id: "cam_b", label: "Caminho B" },
        ],
      }),
      no("marca_a", "crm.add_tag", { tag: "veio-por-a" }),
      no("marca_b", "crm.add_tag", { tag: "veio-por-b" }),
    ],
    edges: [
      aresta("e1", "inicio", "divide"),
      aresta("e2", "divide", "marca_a", "cam_a"),
      aresta("e3", "divide", "marca_b", "cam_b"),
    ],
  };
}

/** Mais um lead: é ENTRE execuções que a fila e o placar precisam sobreviver. */
async function maisUmaExecucao(grafo: FlowGraph, n: number): Promise<void> {
  const proxima = execucaoNova();
  proxima.id = `exec-${n}`;
  mundo.execucoes.set(proxima.id, proxima);
  await rodarTickDeFluxos(mundo.montar(grafo));
}

describe("dividir os caminhos — modo fila", () => {
  it("⭐ leads seguidos vão por caminhos DIFERENTES, alternando", async () => {
    // O defeito que este caso barra: um cursor por execução reiniciaria a cada
    // lead, e a divisão viraria um caminho fixo — sem erro, sem sintoma.
    const grafo = grafoDeDivisao("fila");
    // A tag é acumulada no lead pelo mundo de teste, então cada execução tem de
    // marcar a SUA — quatro leads, quatro marcas, alternadas.
    await rodarTickDeFluxos(mundo.montar(grafo));
    await maisUmaExecucao(grafo, 2);
    await maisUmaExecucao(grafo, 3);
    await maisUmaExecucao(grafo, 4);

    expect(mundo.tags).toEqual(["veio-por-a", "veio-por-b", "veio-por-a", "veio-por-b"]);
  });
});

describe("dividir os caminhos — modo igualitário", () => {
  it("⭐ empata o total entre os caminhos", async () => {
    const grafo = grafoDeDivisao("igualitario");
    await rodarTickDeFluxos(mundo.montar(grafo));
    await maisUmaExecucao(grafo, 2);
    await maisUmaExecucao(grafo, 3);
    await maisUmaExecucao(grafo, 4);

    const porA = mundo.tags.filter((t) => t === "veio-por-a").length;
    const porB = mundo.tags.filter((t) => t === "veio-por-b").length;
    expect(mundo.tags).toHaveLength(4);
    expect(porA, "quatro leads deviam empatar 2 a 2").toBe(2);
    expect(porB).toBe(2);
  });
});

describe("dividir os caminhos — modo aleatório", () => {
  it("cai sempre DENTRO dos caminhos declarados", async () => {
    // Sorteio não se mede por igualdade num teste; o que se mede é que o
    // resultado é sempre um caminho que existe, e que o fluxo anda.
    const grafo = grafoDeDivisao("aleatorio");
    await rodarTickDeFluxos(mundo.montar(grafo));
    await maisUmaExecucao(grafo, 2);
    await maisUmaExecucao(grafo, 3);

    expect(mundo.tags).toHaveLength(3);
    for (const tag of mundo.tags) {
      expect(["veio-por-a", "veio-por-b"]).toContain(tag);
    }
  });

  it("não toca o banco: sorteio não gasta cursor nem placar", async () => {
    await rodarTickDeFluxos(mundo.montar(grafoDeDivisao("aleatorio")));
    expect(mundo.cursoresDaDivisao.size).toBe(0);
    expect(mundo.placarDaDivisao.size).toBe(0);
  });
});

describe("quando o banco não responde", () => {
  it("⭐ a execução SEGUE pelo primeiro caminho, em vez de travar", async () => {
    // A política é a mesma da fila indiana de vendedores: perder a vez uma vez
    // é melhor que segurar o lead. Um `fail` aqui pararia o fluxo inteiro por
    // um contador.
    mundo.divisaoIndisponivel = true;
    await rodarTickDeFluxos(mundo.montar(grafoDeDivisao("igualitario")));

    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.status).not.toBe("failed");
    expect(mundo.tags).toEqual(["veio-por-a"]);
  });
});

describe("as saídas do bloco", () => {
  it("uma por caminho, todas de REGRA, e nenhum pega-tudo", () => {
    // `kind: "match"` obriga a publicação a exigir ligação em cada caminho.
    // Fosse `excecao` ou `fallback`, um caminho solto passaria no publicar — e
    // um em cada N leads terminaria ali, em silêncio.
    const ramos = exigirNo("logic.split").branches({
      modo: "fila",
      caminhos: [
        { id: "cam_a", label: "Caminho A" },
        { id: "cam_b", label: "Caminho B" },
        { id: "cam_c", label: "Caminho C" },
      ],
    } as never);

    expect(ramos.map((r) => r.id)).toEqual(["cam_a", "cam_b", "cam_c"]);
    expect(ramos.map((r) => r.kind)).toEqual(["match", "match", "match"]);
    expect(ramos.some((r) => r.id === "else")).toBe(false);
  });

  it("o caminho escolhido fica no escopo, para os blocos seguintes", async () => {
    await rodarTickDeFluxos(mundo.montar(grafoDeDivisao("fila")));
    const exec = [...mundo.execucoes.values()][0]!;
    expect(exec.context.caminho_escolhido).toBe("cam_a");
  });
});

describe("o schema recusa config que a tela não deve gravar", () => {
  // Lido DENTRO de cada caso: no corpo do `describe` isto roda na coleta, antes
  // do `beforeEach` que povoa o registry — e o arquivo inteiro morre no import.
  const schema = () => exigirNo("logic.split").configSchema;

  it("menos de dois caminhos", () => {
    expect(
      schema().safeParse({ modo: "fila", caminhos: [{ id: "a", label: "A" }] }).success,
    ).toBe(false);
  });

  it("ids repetidos — seriam duas saídas com o mesmo handle", () => {
    expect(
      schema().safeParse({
        modo: "fila",
        caminhos: [
          { id: "a", label: "A" },
          { id: "a", label: "Outro A" },
        ],
      }).success,
    ).toBe(false);
  });

  it("modo inventado", () => {
    expect(
      schema().safeParse({
        modo: "por_peso",
        caminhos: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      }).success,
    ).toBe(false);
  });
});
