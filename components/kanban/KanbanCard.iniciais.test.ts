import { describe, expect, it } from "vitest";

import { iniciais } from "./KanbanCard";

describe("iniciais do avatar do card", () => {
  it("parte por espaço, não pela letra s", () => {
    expect(iniciais("Maria Souza")).toBe("MS");
    expect(iniciais("Sarah Silva Santos")).toBe("SS");
    expect(iniciais("  Joãozinho  ")).toBe("JO");
    expect(iniciais("")).toBe("?");
  });
});

import { previsaoDeFechamento } from "./KanbanCard";

describe("previsão de fechamento no card", () => {
  const hoje = new Date("2026-10-27T12:00:00Z");
  it("dia/mês, sem atraso quando é hoje ou depois", () => {
    expect(previsaoDeFechamento("2026-11-12", hoje)).toEqual({ texto: "12/11", atrasada: false });
    expect(previsaoDeFechamento("2026-10-27", hoje)).toEqual({ texto: "27/10", atrasada: false });
  });
  it("atrasada quando o dia já passou", () => {
    expect(previsaoDeFechamento("2026-10-20", hoje)?.atrasada).toBe(true);
  });
  it("sem data ou data torta: nada", () => {
    expect(previsaoDeFechamento(null, hoje)).toBeNull();
    expect(previsaoDeFechamento("amanhã", hoje)).toBeNull();
  });
});
