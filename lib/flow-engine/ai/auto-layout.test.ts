import { describe, expect, it } from "vitest";

import { autoLayout } from "./auto-layout";

describe("autoLayout", () => {
  it("grafo linear: cada nó numa coluna, uma coluna por passo do BFS", () => {
    const nos = [
      { id: "a", type: "trigger.lead_created" },
      { id: "b", type: "logic.wait" },
      { id: "c", type: "logic.end" },
    ];
    const arestas = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ];
    const pos = autoLayout(nos, arestas);

    expect(pos.a!.x).toBeLessThan(pos.b!.x);
    expect(pos.b!.x).toBeLessThan(pos.c!.x);
    // Mesma linha — cada um é o único nó da própria coluna.
    expect(pos.a!.y).toBe(pos.b!.y);
    expect(pos.b!.y).toBe(pos.c!.y);
  });

  it("grafo ramificado: dois nós na mesma coluna ficam em linhas diferentes", () => {
    const nos = [
      { id: "trigger", type: "trigger.lead_created" },
      { id: "sim", type: "crm.add_tag" },
      { id: "nao", type: "crm.add_tag" },
    ];
    const arestas = [
      { source: "trigger", target: "sim" },
      { source: "trigger", target: "nao" },
    ];
    const pos = autoLayout(nos, arestas);

    expect(pos.sim!.x).toBe(pos.nao!.x);
    expect(pos.sim!.y).not.toBe(pos.nao!.y);
  });

  it("nó inalcançável a partir do trigger não fica sobreposto a nenhum outro", () => {
    const nos = [
      { id: "trigger", type: "trigger.lead_created" },
      { id: "conectado", type: "logic.end" },
      { id: "orfao", type: "notify.internal" },
    ];
    const arestas = [{ source: "trigger", target: "conectado" }];
    const pos = autoLayout(nos, arestas);

    const chaves = Object.values(pos).map((p) => `${p.x},${p.y}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("determinístico: mesma entrada produz sempre a mesma saída", () => {
    const nos = [
      { id: "a", type: "trigger.lead_created" },
      { id: "b", type: "logic.if" },
      { id: "c", type: "crm.add_tag" },
      { id: "d", type: "logic.end" },
    ];
    const arestas = [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
      { source: "b", target: "d" },
    ];
    expect(autoLayout(nos, arestas)).toEqual(autoLayout(nos, arestas));
  });

  it("grafo vazio não lança e devolve objeto vazio", () => {
    expect(autoLayout([], [])).toEqual({});
  });

  it("acha o trigger mesmo que não seja o primeiro nó da lista", () => {
    const nos = [
      { id: "depois", type: "logic.end" },
      { id: "inicio", type: "trigger.lead_created" },
    ];
    const arestas = [{ source: "inicio", target: "depois" }];
    const pos = autoLayout(nos, arestas);
    expect(pos.inicio!.x).toBeLessThan(pos.depois!.x);
  });

  it("sem nó de trigger: usa o primeiro da lista como raiz, sem lançar", () => {
    const nos = [
      { id: "a", type: "crm.add_tag" },
      { id: "b", type: "logic.end" },
    ];
    const arestas = [{ source: "a", target: "b" }];
    expect(() => autoLayout(nos, arestas)).not.toThrow();
  });
});
