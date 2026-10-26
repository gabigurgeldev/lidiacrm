import { describe, expect, it } from "vitest";

import { midpoint, posicaoNoIndice } from "./fractional-indexing";

describe("posicaoNoIndice — soltar um card nunca aborta", () => {
  it("entre dois vizinhos distintos é o meio", () => {
    expect(posicaoNoIndice([1000, 2000], 1)).toBe(1500);
  });

  it("topo e fim da coluna seguem a régua de 1000", () => {
    expect(posicaoNoIndice([1000, 2000], 0)).toBe(0);
    expect(posicaoNoIndice([1000, 2000], 2)).toBe(3000);
    expect(posicaoNoIndice([], 0)).toBe(1000);
  });

  it("vizinhos EMPATADOS: midpoint dá NaN, aqui sai uma posição válida acima do empate", () => {
    expect(Number.isNaN(midpoint(1000, 1000))).toBe(true);
    const p = posicaoNoIndice([1000, 1000, 1000, 2000], 1);
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBeGreaterThan(1000);
    expect(p).toBeLessThan(2000);
  });

  it("empate no fim da coluna: vai para depois dele", () => {
    expect(posicaoNoIndice([500, 500], 1)).toBe(1500);
  });
});
