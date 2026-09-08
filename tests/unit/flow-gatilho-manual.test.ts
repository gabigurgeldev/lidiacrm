import { beforeAll, describe, expect, it } from "vitest";

import { acharNoDeGatilho, kindDoGatilho } from "@/lib/flow-engine/gatilho";
import { buscarNo, todosOsNos } from "@/lib/flow-engine/registry";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";

beforeAll(() => garantirNosRegistrados());

function grafoCom(type: string) {
  return {
    nodes: [
      { id: "n1", type, label: "início", position: { x: 0, y: 0 }, config: {} },
      { id: "n2", type: "logic.end", label: "fim", position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2", branch_id: "else" }],
  };
}

describe("trigger.manual — o gatilho do botão", () => {
  it("está registrado, é gatilho e NÃO declara eventos", () => {
    const def = buscarNo("trigger.manual");
    expect(def).toBeDefined();
    expect(def?.category).toBe("trigger");
    // Sem `eventos`: é o que garante que o matcher nunca o arma por evento.
    expect(def?.eventos ?? []).toEqual([]);
  });

  it("nenhum evento arma o gatilho manual", () => {
    // O matcher monta o conjunto de tipos a armar a partir de `eventos`. Um nó
    // sem `eventos` não entra em nenhum conjunto, para nenhum event_type.
    const eventos = new Set(todosOsNos().flatMap((n) => n.eventos ?? []));
    for (const ev of eventos) {
      const armados = todosOsNos()
        .filter((n) => (n.eventos ?? []).includes(ev))
        .map((n) => n.type);
      expect(armados).not.toContain("trigger.manual");
    }
  });
});

describe("kindDoGatilho / acharNoDeGatilho", () => {
  it("deriva 'manual' do grafo com trigger.manual", () => {
    expect(kindDoGatilho(grafoCom("trigger.manual"))).toBe("manual");
    expect(acharNoDeGatilho(grafoCom("trigger.manual"))).toEqual({ id: "n1", type: "trigger.manual" });
  });

  it("deriva 'event' do grafo com trigger.lead_created", () => {
    expect(kindDoGatilho(grafoCom("trigger.lead_created"))).toBe("event");
  });

  it("devolve null quando o grafo não tem gatilho", () => {
    const semGatilho = {
      nodes: [{ id: "n1", type: "logic.end", label: "fim", position: { x: 0, y: 0 }, config: {} }],
      edges: [],
    };
    expect(kindDoGatilho(semGatilho)).toBeNull();
    expect(acharNoDeGatilho(semGatilho)).toBeNull();
  });
});
