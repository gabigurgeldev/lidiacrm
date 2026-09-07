/**
 * O PRÉ-FILTRO DE CANAL — quais mensagens chegam a virar execução.
 *
 * ## Por que este filtro não está no `execute` do nó
 *
 * O cabeçalho de `nodes/gatilhos-e-menu.ts` descreve as duas saídas para
 * filtrar um gatilho — decidir no nó (a) ou pré-filtrar aqui (b) — e diz que a
 * (b) "só se paga com volume medido". O volume chegou: um cliente com SEIS
 * números conectados e um fluxo que escuta um. Pela (a), cada mensagem dos
 * outros cinco viraria uma execução nascida morta, e a tela de Execuções — que
 * é onde se descobre por que um fluxo não fez nada — encheria de linhas mortas
 * que escondem as que importam.
 *
 * ## O que estes testes travam
 *
 * O comportamento OBSERVÁVEL: criou execução, ou não criou. Testar
 * `escutaEsteCanal` direto provaria a comparação de strings e não provaria a
 * única coisa que interessa — que o `insert` não acontece.
 *
 * E o caso de compatibilidade é tão importante quanto o novo: fluxo publicado
 * ANTES deste campo existir não tem `canal_id` nenhum no grafo, e ele precisa
 * seguir disparando para todos os números, sem republicar.
 */
import { describe, expect, it, vi } from "vitest";

import { armarFluxosParaEvento } from "./trigger-matcher";

const CANAL_A = "c5dfb271-f922-4607-8bed-c1a7188d9484";
const CANAL_B = "e40dc9a0-45b7-4a4e-a0b1-b65a417c047a";

function evento(channelSessionId: string) {
  return {
    id: "evt-1",
    organization_id: "org-1",
    event_type: "message.received",
    entity_kind: "message",
    entity_id: "msg-1",
    payload: { body_preview: "oi", channel_session_id: channelSessionId, contact_id: "ct-1" },
    metadata: {},
  } as unknown as Parameters<typeof armarFluxosParaEvento>[1];
}

/**
 * Um Supabase de mentira que responde por TABELA. `insert` é um espião: é ele
 * que responde à única pergunta que este arquivo faz.
 */
function admin(configDoGatilho: Record<string, unknown>) {
  const insert = vi.fn(async () => ({ error: null }));
  const grafo = {
    nodes: [
      { id: "n1", type: "trigger.keyword", label: "g", position: { x: 0, y: 0 }, config: configDoGatilho },
    ],
    edges: [],
  };
  const cliente = {
    from(tabela: string) {
      if (tabela === "flow_executions") return { insert };
      const linha =
        tabela === "flows"
          ? [{ id: "f1", organization_id: "org-1", active_version_id: "v1", settings: {} }]
          : { id: "v1", graph: grafo, trigger_config: {} };
      const cadeia: Record<string, unknown> = {
        then: (r: (v: unknown) => unknown) => Promise.resolve({ data: linha, error: null }).then(r),
      };
      for (const m of ["select", "eq", "not", "maybeSingle"]) {
        cadeia[m] = () =>
          m === "maybeSingle" ? Promise.resolve({ data: linha, error: null }) : cadeia;
      }
      return cadeia;
    },
  };
  return { cliente: cliente as never, insert };
}

describe("o gatilho escuta um número escolhido", () => {
  it("⭐ mensagem do número escutado VIRA execução", async () => {
    const a = admin({ palavras: ["oi"], modo: "contem", canal_id: CANAL_A });
    await armarFluxosParaEvento(a.cliente, evento(CANAL_A));
    expect(a.insert).toHaveBeenCalledTimes(1);
  });

  it("⭐ mensagem de OUTRO número não cria execução nenhuma", async () => {
    // O ponto da feature. Sem isto, cada mensagem dos outros cinco números do
    // cliente viraria uma linha morta na tela de Execuções.
    const a = admin({ palavras: ["oi"], modo: "contem", canal_id: CANAL_A });
    await armarFluxosParaEvento(a.cliente, evento(CANAL_B));
    expect(a.insert).not.toHaveBeenCalled();
  });
});

describe("compatibilidade — fluxo publicado antes do campo existir", () => {
  it("⭐ sem `canal_id` no grafo, dispara para qualquer número", async () => {
    // Todo fluxo já publicado cai aqui. Se este caso quebrasse, a feature nova
    // desligaria os fluxos que já funcionavam.
    const a = admin({ palavras: ["oi"], modo: "contem" });
    await armarFluxosParaEvento(a.cliente, evento(CANAL_B));
    expect(a.insert).toHaveBeenCalledTimes(1);
  });

  it("⭐ `canal_id: null` é 'todos os números', não 'nenhum'", async () => {
    const a = admin({ palavras: ["oi"], modo: "contem", canal_id: null });
    await armarFluxosParaEvento(a.cliente, evento(CANAL_B));
    expect(a.insert).toHaveBeenCalledTimes(1);
  });
});
