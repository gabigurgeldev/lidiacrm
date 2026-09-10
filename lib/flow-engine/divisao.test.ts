import { describe, expect, it } from "vitest";

import { escolherAleatorio, escolherPorFila, escolherPorPlacar } from "./divisao";

describe("escolherAleatorio", () => {
  it("alcança TODOS os caminhos conforme o sorteio anda", () => {
    // Com `rng` fixo por chamada, cada faixa do [0,1) tem de cair num caminho
    // diferente. Um teste que só verificasse "devolveu algum id" passaria com
    // uma implementação que devolve sempre o primeiro — que é o defeito.
    const ids = ["a", "b", "c"];
    expect(escolherAleatorio(ids, () => 0)).toBe("a");
    expect(escolherAleatorio(ids, () => 0.5)).toBe("b");
    expect(escolherAleatorio(ids, () => 0.99)).toBe("c");
  });

  it("não estoura quando o rng devolve 1", () => {
    // `Math.floor(1 * 3)` é 3, fora do array. O piso existe por isso.
    expect(escolherAleatorio(["a", "b", "c"], () => 1)).toBe("c");
  });

  it("sorteia sobre ordem estável: a ordem de entrada não muda o resultado", () => {
    const rng = () => 0.4;
    expect(escolherAleatorio(["c", "a", "b"], rng)).toBe(escolherAleatorio(["a", "b", "c"], rng));
  });

  it("devolve null sem caminhos", () => {
    expect(escolherAleatorio([])).toBeNull();
  });
});

describe("escolherPorFila", () => {
  it("gira na ordem DESENHADA, e volta ao primeiro", () => {
    const ids = ["z", "a", "m"]; // fora de ordem alfabética de propósito
    const saida = [0, 1, 2, 3, 4, 5].map((cursor) => escolherPorFila(ids, cursor));
    expect(saida).toEqual(["z", "a", "m", "z", "a", "m"]);
  });

  it("aguenta cursor negativo sem sair do array", () => {
    // `-1 % 3` é -1 em JS: sem o piso, sairia `undefined` e o bloco morreria
    // por um dado que não é dele.
    expect(escolherPorFila(["a", "b", "c"], -1)).toBe("c");
  });

  it("devolve null sem caminhos", () => {
    expect(escolherPorFila([], 0)).toBeNull();
  });
});

describe("escolherPorPlacar", () => {
  it("manda para quem está ATRÁS", () => {
    expect(escolherPorPlacar(["a", "b"], { a: 5, b: 2 })).toBe("b");
  });

  it("empate resolve pelo id, sempre igual", () => {
    expect(escolherPorPlacar(["b", "a"], { a: 3, b: 3 })).toBe("a");
    expect(escolherPorPlacar(["b", "a"], { a: 3, b: 3 })).toBe("a");
  });

  it("caminho ACRESCENTADO depois absorve até empatar — é o que 'compensa' significa", () => {
    // O cenário real: dois caminhos rodando há um mês, um terceiro entra hoje.
    const placar: Record<string, number> = { a: 10, b: 10 };
    const ids = ["a", "b", "c"];

    const saidas: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const escolhido = escolherPorPlacar(ids, placar);
      if (escolhido === null) throw new Error("nunca devolve null com caminhos");
      saidas.push(escolhido);
      placar[escolhido] = (placar[escolhido] ?? 0) + 1;
    }

    // As dez primeiras vão TODAS para o caminho novo, até ele alcançar.
    expect(saidas.slice(0, 10)).toEqual(Array<string>(10).fill("c"));
    // Depois de empatar, volta a alternar entre os três.
    expect(new Set(saidas.slice(10))).toEqual(new Set(["a", "b"]));
    expect(placar).toEqual({ a: 11, b: 11, c: 10 });
  });

  it("placar vazio conta zero para todos", () => {
    expect(escolherPorPlacar(["b", "a"], {})).toBe("a");
  });

  it("devolve null sem caminhos", () => {
    expect(escolherPorPlacar([], { a: 1 })).toBeNull();
  });
});
