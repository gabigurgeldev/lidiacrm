/**
 * AS DUAS FORMAS NOVAS DE ESCOLHER QUEM ATENDE.
 *
 * Elas existem porque o rodízio responde UMA pergunta ("de quem é a vez, por
 * justiça") e há duas outras que times fazem de verdade:
 *
 *   - "que ninguém saiba de quem é a vez" → sorteio;
 *   - "a ordem é esta, e é ela que vale" → fila indiana.
 *
 * O que este arquivo protege, em ordem de gravidade:
 *
 *   1. a fila ANDA. Um `selectFixedOrder` que ignorasse o cursor entregaria
 *      sempre ao primeiro da ordem, e a tela mostraria uma fila configurada que
 *      na prática é um vendedor fixo — sem erro nenhum;
 *   2. quem está indisponível é PULADO, e a vez dele não some;
 *   3. o sorteio é sorteio (usa o `rng` que recebe) e não um rodízio disfarçado.
 */
import { describe, expect, it } from "vitest";

import { selectFixedOrder, selectRandom } from "./decide";
import type { RoutingCandidate } from "./decide";

const cand = (id: string): RoutingCandidate => ({ userId: id }) as RoutingCandidate;
const ORDEM = ["ana", "bruno", "carla"];

describe("fila indiana: a ordem declarada, percorrida em volta", () => {
  it("⭐ ANDA: cursores diferentes entregam a pessoas diferentes", () => {
    // O defeito que este caso barra: ignorar o cursor devolveria "ana" sempre,
    // e a fila configurada seria, na prática, um vendedor fixo.
    const todos = ORDEM.map(cand);
    expect(selectFixedOrder(ORDEM, todos, 0).userId).toBe("ana");
    expect(selectFixedOrder(ORDEM, todos, 1).userId).toBe("bruno");
    expect(selectFixedOrder(ORDEM, todos, 2).userId).toBe("carla");
  });

  it("dá a volta no fim da ordem", () => {
    const todos = ORDEM.map(cand);
    expect(selectFixedOrder(ORDEM, todos, 3).userId).toBe("ana");
    expect(selectFixedOrder(ORDEM, todos, 0).proximoCursor).toBe(1);
    expect(selectFixedOrder(ORDEM, todos, 2).proximoCursor).toBe(0);
  });

  it("⭐ pula quem não está disponível, em vez de segurar a fila", () => {
    // Bruno saiu para almoçar. Parar a fila até ele voltar seguraria todos os
    // leads seguintes atrás dele.
    const semBruno = [cand("ana"), cand("carla")];
    const r = selectFixedOrder(ORDEM, semBruno, 1);
    expect(r.userId).toBe("carla");
    expect(r.proximoCursor, "o cursor precisa passar de carla, não de bruno").toBe(0);
  });

  it("ninguém elegível: não escolhe, e o cursor NÃO anda", () => {
    // Se o cursor andasse aqui, quem estava na vez perderia a vez por causa de
    // um momento em que ninguém estava disponível — fora do horário, por exemplo.
    const r = selectFixedOrder(ORDEM, [], 1);
    expect(r.userId).toBeNull();
    expect(r.proximoCursor).toBe(1);
  });

  it("ordem vazia não escolhe ninguém", () => {
    expect(selectFixedOrder([], [cand("ana")], 0).userId).toBeNull();
  });

  it("quem está elegível mas fora da ordem NÃO recebe", () => {
    // A ordem é a lista de quem participa desta fila. Um elegível de fora dela
    // entrando seria a fila deixando de ser a fila.
    expect(selectFixedOrder(["ana"], [cand("bruno")], 0).userId).toBeNull();
  });
});

describe("sorteio", () => {
  it("⭐ usa o sorteio que recebe — não é rodízio disfarçado", () => {
    const todos = [cand("ana"), cand("bruno"), cand("carla")];
    // Ordenados por id: ana(0), bruno(1), carla(2).
    expect(selectRandom(todos, () => 0)).toBe("ana");
    expect(selectRandom(todos, () => 0.5)).toBe("bruno");
    expect(selectRandom(todos, () => 0.99)).toBe("carla");
  });

  it("rng no limite não estoura a lista", () => {
    // `Math.random()` nunca devolve 1, mas um `rng` injetado pode — e um índice
    // fora da lista devolveria `undefined` como se não houvesse ninguém.
    expect(selectRandom([cand("ana"), cand("bruno")], () => 1)).toBe("bruno");
  });

  it("lista vazia devolve null", () => {
    expect(selectRandom([], () => 0)).toBeNull();
  });

  it("a ordem de chegada não muda o resultado do mesmo sorteio", () => {
    // Sem ordenação estável, o mesmo `rng` daria pessoas diferentes conforme a
    // ordem que o banco devolveu — irreproduzível, e impossível de investigar.
    const a = selectRandom([cand("carla"), cand("ana"), cand("bruno")], () => 0);
    const b = selectRandom([cand("ana"), cand("bruno"), cand("carla")], () => 0);
    expect(a).toBe(b);
  });
});
