/**
 * AS DECISÕES DO PARALELO — aritmética, provada sem banco.
 *
 * Cada caso aqui é um modo de falha concreto de motor de automação, e os três
 * piores não dão erro nenhum quando acontecem:
 *
 *   1. dois ramos gravando a mesma variável, e o fluxo segue com o valor de
 *      quem terminou por último;
 *   2. um merge esperando por uma frente que nunca vai chegar, e o fluxo fica
 *      parado para sempre sem uma linha em lugar nenhum;
 *   3. a corrida que não cancela o perdedor, e o cliente recebe a cobrança
 *      automática logo depois de dizer que ia pagar.
 *
 * Os três são silenciosos. É por isso que estas funções foram extraídas do
 * motor: para poderem ser exercitadas sem Postgres, e portanto para poderem ser
 * exercitadas.
 */
import { describe, expect, it } from "vitest";

import {
  escopoDaFrente,
  eventoAcordaAFrente,
  frentesDoFork,
  ondeGravar,
  proximoPassoDoLaco,
  veredictoDoEncontro,
  type FrenteRow,
} from "./frentes";

function frente(over: Partial<FrenteRow> = {}): FrenteRow {
  return {
    id: "f1",
    organization_id: "org-1",
    execution_id: "exec-1",
    parent_frame_id: null,
    node_id: "n1",
    status: "ready",
    next_eval_at: "2026-09-01T12:00:00.000Z",
    steps_taken: 0,
    vars: {},
    fork_node_id: null,
    awaiting_event_type: null,
    awaiting_match: null,
    wait_deadline: null,
    loop_node_id: null,
    loop_index: null,
    loop_total: null,
    ...over,
  };
}

describe("o fork abre uma frente por DESTINO, não por ramo", () => {
  const base = {
    organizationId: "org-1",
    executionId: "exec-1",
    paiId: "f1",
    forkNodeId: "bifurca",
    varsDoPai: { origem: "meta_ads" },
    agoraIso: "2026-09-01T12:00:00.000Z",
  };

  it("três destinos rendem três frentes prontas, todas marcadas com o fork", () => {
    const filhas = frentesDoFork({ ...base, destinos: ["a", "b", "c"] });

    expect(filhas).toHaveLength(3);
    expect(filhas.map((f) => f.node_id)).toEqual(["a", "b", "c"]);
    expect(filhas.every((f) => f.status === "ready")).toBe(true);
    expect(filhas.every((f) => f.fork_node_id === "bifurca")).toBe(true);
    expect(filhas.every((f) => f.parent_frame_id === "f1")).toBe(true);
  });

  it("ramo do fork que ninguém ligou NÃO vira frente", () => {
    // O defeito clássico do fan-out. Uma frente sem destino nunca andaria, mas
    // contaria em `esperadas` — e o merge em modo `todas` esperaria para sempre
    // por ela. Fluxo travado, sem erro, sem linha de log: o modo de falha mais
    // caro de diagnosticar que este motor pode ter.
    const filhas = frentesDoFork({ ...base, destinos: ["a", "c"] });
    expect(filhas).toHaveLength(2);
  });

  it("as filhas HERDAM as vars do pai, por CÓPIA", () => {
    const filhas = frentesDoFork({ ...base, destinos: ["a", "b"] });

    expect(filhas[0]!.vars).toEqual({ origem: "meta_ads" });

    // Escrever numa não pode aparecer na outra. Compartilhar a referência faria
    // uma enxergar a escrita da irmã — exatamente o que o espaço local existe
    // para impedir.
    filhas[0]!.vars.escolha = "quente";
    expect(filhas[1]!.vars).toEqual({ origem: "meta_ads" });
  });
});

describe("o encontro dos ramos", () => {
  it("modo TODAS: as primeiras param, só a última segue", () => {
    const de = (chegadas: number) =>
      veredictoDoEncontro({ modo: "todas", esperadas: 3, chegadas, resolvido_em: null });

    expect(de(1)).toEqual({ kind: "para" });
    expect(de(2)).toEqual({ kind: "para" });
    // Alguém tem de seguir, e só uma pode: duas frentes saindo do mesmo merge
    // refariam o fan-out sem ninguém ter pedido.
    expect(de(3)).toEqual({ kind: "segue", cancelar_irmas: false });
  });

  it("modo PRIMEIRA: a primeira segue e manda cancelar as irmãs", () => {
    // Sem o cancelamento, "espera o cliente responder OU 24h passarem" seguiria
    // rodando o ramo do tempo depois de o cliente ter respondido — e a cobrança
    // automática sairia logo após a pessoa dizer que ia pagar. O cancelamento é
    // o que faz "OU" significar OU.
    const v = veredictoDoEncontro({
      modo: "primeira",
      esperadas: 3,
      chegadas: 1,
      resolvido_em: null,
    });
    expect(v).toEqual({ kind: "segue", cancelar_irmas: true });
  });

  it("encontro JÁ resolvido não deixa ninguém passar de novo", () => {
    // É o caminho do retry: a frente foi reclamada outra vez depois de o merge
    // já ter disparado. Sem esta guarda o merge dispararia duas vezes.
    for (const modo of ["todas", "primeira"] as const) {
      expect(
        veredictoDoEncontro({
          modo,
          esperadas: 2,
          chegadas: 2,
          resolvido_em: "2026-09-01T12:00:00.000Z",
        }),
        modo,
      ).toEqual({ kind: "para" });
    }
  });
});

describe("o laço", () => {
  it("primeira visita entra no índice 0", () => {
    // `indiceAtual: null` é "estou entrando"; é o mesmo protocolo de duas
    // visitas que `logic.wait` usa com `esperaEmCurso`.
    expect(proximoPassoDoLaco({ indiceAtual: null, totalDeItens: 3, max: 10 })).toEqual({
      kind: "corpo",
      indice: 0,
      total: 3,
    });
  });

  it("percorre e termina no fim da lista", () => {
    expect(proximoPassoDoLaco({ indiceAtual: 0, totalDeItens: 3, max: 10 }).kind).toBe("corpo");
    expect(proximoPassoDoLaco({ indiceAtual: 1, totalDeItens: 3, max: 10 }).kind).toBe("corpo");
    expect(proximoPassoDoLaco({ indiceAtual: 2, totalDeItens: 3, max: 10 })).toEqual({
      kind: "fim",
    });
  });

  it("o TETO corta a lista, e é por isso que o laço pode existir", () => {
    // A validação de publicação proibia QUALQUER ciclo porque um ciclo sem teto
    // queima `steps_taken` até a execução morrer. Com teto declarado, o ciclo
    // tem fim conhecido antes de começar — e uma lista de mil itens vinda de uma
    // API não vira mil chamadas pagas.
    expect(proximoPassoDoLaco({ indiceAtual: 1, totalDeItens: 1000, max: 2 })).toEqual({
      kind: "fim",
    });
  });

  it("lista vazia termina sem executar o corpo nenhuma vez", () => {
    expect(proximoPassoDoLaco({ indiceAtual: null, totalDeItens: 0, max: 10 })).toEqual({
      kind: "fim",
    });
  });

  it("teto zero ou negativo não executa nada, em vez de rodar para sempre", () => {
    expect(proximoPassoDoLaco({ indiceAtual: null, totalDeItens: 5, max: 0 }).kind).toBe("fim");
    expect(proximoPassoDoLaco({ indiceAtual: null, totalDeItens: 5, max: -3 }).kind).toBe("fim");
  });
});

describe("onde uma escrita de var cai", () => {
  it("FORA de fork grava no espaço compartilhado da execução", () => {
    // É o que faz `{{vars.dono_escolhido}}` seguir funcionando como sempre —
    // o comportamento que os 20 casos de `engine.test.ts` exercitam.
    expect(ondeGravar(frente({ fork_node_id: null }))).toBe("execucao");
  });

  it("DENTRO de fork grava no espaço da própria frente", () => {
    // A asserção que separa paralelo correto de paralelo bonito. No espaço
    // compartilhado, dois ramos gravando a mesma chave produzem o valor de quem
    // terminou por último — sem erro, com o fluxo seguindo e entregando errado.
    expect(ondeGravar(frente({ fork_node_id: "bifurca" }))).toBe("frente");
  });
});

describe("a espera por evento", () => {
  const esperando = (over: Partial<FrenteRow> = {}) =>
    frente({ status: "waiting", awaiting_event_type: "message.received", ...over });

  it("acorda com o evento do tipo esperado", () => {
    expect(
      eventoAcordaAFrente({
        frente: esperando(),
        eventType: "message.received",
        payload: { conversation_id: "c1" },
      }),
    ).toBe(true);
  });

  it("NÃO acorda com evento de outro tipo", () => {
    expect(
      eventoAcordaAFrente({
        frente: esperando(),
        eventType: "message.sent",
        payload: {},
      }),
    ).toBe(false);
  });

  it("com filtro, só acorda com o evento DAQUELA conversa", () => {
    // Sem isto, a resposta de um cliente acordaria a espera de outro — que é o
    // pior tipo de vazamento entre conversas, porque não é de dado, é de
    // comportamento: o fluxo de A segue com o gatilho de B.
    const f = esperando({ awaiting_match: { conversation_id: "c1" } });

    expect(
      eventoAcordaAFrente({ frente: f, eventType: "message.received", payload: { conversation_id: "c1" } }),
    ).toBe(true);
    expect(
      eventoAcordaAFrente({ frente: f, eventType: "message.received", payload: { conversation_id: "c2" } }),
    ).toBe(false);
  });

  it("filtro vazio aceita qualquer evento daquele tipo", () => {
    expect(
      eventoAcordaAFrente({
        frente: esperando({ awaiting_match: {} }),
        eventType: "message.received",
        payload: { conversation_id: "qualquer" },
      }),
    ).toBe(true);
  });

  it("frente que NÃO espera evento nenhum nunca é acordada", () => {
    expect(
      eventoAcordaAFrente({
        frente: frente({ awaiting_event_type: null }),
        eventType: "message.received",
        payload: {},
      }),
    ).toBe(false);
  });

  it("o número 1 não casa com o texto \"1\"", () => {
    // Coerção seria conveniente até o dia em que um id numérico casa com um id
    // textual de outra entidade, e aí o fluxo de alguém segue pelo evento de
    // outro alguém.
    const f = esperando({ awaiting_match: { pedido_id: 1 } });
    expect(
      eventoAcordaAFrente({ frente: f, eventType: "message.received", payload: { pedido_id: "1" } }),
    ).toBe(false);
    expect(
      eventoAcordaAFrente({ frente: f, eventType: "message.received", payload: { pedido_id: 1 } }),
    ).toBe(true);
  });
});

describe("o escopo que a frente entrega", () => {
  it("carrega as vars locais e a posição no laço", () => {
    expect(
      escopoDaFrente(frente({ vars: { item: "x" }, loop_index: 2, loop_total: 5 })),
    ).toEqual({ vars: { item: "x" }, loop_index: 2, loop_total: 5 });
  });

  it("fora de laço, índice e total são nulos — não zero", () => {
    // Zero é uma posição válida (o primeiro item). Confundir "não estou num
    // laço" com "estou no item 0" faria `{{frame.loop_index}}` escrever "0" em
    // toda mensagem de fluxo que não tem laço nenhum.
    expect(escopoDaFrente(frente()).loop_index).toBeNull();
    expect(escopoDaFrente(frente()).loop_total).toBeNull();
  });
});
