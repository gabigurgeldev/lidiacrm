/**
 * O ACORDADOR — a metade da espera por evento que ninguém coleta sozinho.
 *
 * O prazo o motor recolhe sozinho, porque relógio vencido é a única coisa que o
 * claim sabe procurar. O evento não: sem este consumidor, a saída "Aconteceu"
 * do bloco de espera é um handle que a pessoa liga no canvas e por onde o fluxo
 * nunca passa — TODA espera terminaria pelo prazo, inclusive as que o cliente
 * respondeu em dois minutos.
 *
 * O caso mais grave aqui não é a frente que não acorda: é a que acorda por um
 * evento que não era dela.
 */
import { describe, expect, it } from "vitest";

import { acordarFrentesQueEsperam, VAR_DO_EVENTO } from "./acordar-por-evento";
import type { FrenteRow } from "./frentes";

const ORG = "org-1";

function frente(over: Partial<FrenteRow> = {}): FrenteRow {
  return {
    id: "f1",
    organization_id: ORG,
    execution_id: "exec-1",
    parent_frame_id: null,
    node_id: "aguarda",
    status: "waiting",
    next_eval_at: "2026-09-02T12:00:00.000Z",
    steps_taken: 3,
    vars: { origem: "meta_ads" },
    fork_node_id: null,
    awaiting_event_type: "message.received",
    awaiting_match: null,
    wait_deadline: "2026-09-03T12:00:00.000Z",
    loop_node_id: null,
    loop_index: null,
    loop_total: null,
    ...over,
  };
}

/**
 * Um Supabase de mentira que registra o que foi pedido.
 *
 * Guarda os FILTROS de cada update, e não só o resultado: o caso que mais
 * importa provar aqui é que a consulta filtra `organization_id`, e isso é
 * invisível num fake que só devolve linhas.
 */
function adminFalso(frentes: FrenteRow[]) {
  const updates: Array<{ tabela: string; patch: Record<string, unknown>; filtros: Record<string, unknown> }> = [];
  let consultaDeFrentes: Record<string, unknown> = {};

  const construtor = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const eu = {
      select: () => eu,
      update: (p: Record<string, unknown>) => {
        patch = p;
        return eu;
      },
      eq: (col: string, val: unknown) => {
        filtros[col] = val;
        return eu;
      },
      in: (col: string, val: unknown) => {
        filtros[col] = val;
        return eu;
      },
      then: (resolve: (r: unknown) => void) => {
        if (patch !== null) {
          updates.push({ tabela, patch, filtros });
          resolve({ data: null, error: null });
          return;
        }
        consultaDeFrentes = filtros;
        resolve({ data: frentes, error: null });
      },
    };
    return eu;
  };

  return {
    admin: { from: construtor } as never,
    updates,
    consulta: () => consultaDeFrentes,
  };
}

describe("acordar quem esperava", () => {
  it("acorda a frente e guarda o payload no espaço DELA", async () => {
    const mundo = adminFalso([frente()]);
    const r = await acordarFrentesQueEsperam(mundo.admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "message.received",
      payload: { conversation_id: "c1", texto: "pode mandar o boleto" },
    });

    expect(r.status).toBe("ok");

    const daFrente = mundo.updates.find((u) => u.tabela === "flow_execution_frames")!;
    expect(daFrente.patch.status).toBe("ready");
    // Limpar isto É o sinal de "voltei porque o evento chegou", e é também o
    // que impede um segundo evento do mesmo tipo de acordar de novo.
    expect(daFrente.patch.awaiting_event_type).toBeNull();
    expect(daFrente.patch.wait_deadline).toBeNull();

    // O payload entra no espaço LOCAL, junto do que a frente já tinha.
    expect(daFrente.patch.vars).toEqual({
      origem: "meta_ads",
      [VAR_DO_EVENTO]: { conversation_id: "c1", texto: "pode mandar o boleto" },
    });
  });

  it("acorda também a EXECUÇÃO — é o relógio dela que o motor procura", async () => {
    // A frente pronta não adianta nada se a execução seguir dormindo: o claim
    // do motor procura execuções vencidas, não frentes.
    const mundo = adminFalso([frente()]);
    await acordarFrentesQueEsperam(mundo.admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "message.received",
      payload: {},
    });

    const daExecucao = mundo.updates.find((u) => u.tabela === "flow_executions")!;
    expect(daExecucao.patch.status).toBe("pending");
    expect(daExecucao.filtros.id).toBe("exec-1");
  });

  it("filtra organization_id NA CONSULTA — e a org vem do evento", async () => {
    // ⚠️ Usa o cliente admin, que passa por cima da RLS (anti-pattern nº 10).
    // Sem este filtro, a mensagem de um cliente acordaria a espera de outro
    // TENANT — vazamento de comportamento, não só de dado: o fluxo de uma
    // empresa seguiria pelo gatilho de outra.
    const mundo = adminFalso([frente()]);
    await acordarFrentesQueEsperam(mundo.admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "message.received",
      payload: {},
    });

    expect(mundo.consulta().organization_id).toBe(ORG);
    expect(mundo.consulta().awaiting_event_type).toBe("message.received");
    expect(mundo.consulta().status).toBe("waiting");
    for (const u of mundo.updates) {
      expect(u.filtros.organization_id, `${u.tabela} sem filtro de org`).toBe(ORG);
    }
  });

  it("NÃO acorda a frente cujo filtro não casa", async () => {
    // A resposta do cliente A não pode acordar a espera do cliente B. É o mesmo
    // `eventoAcordaAFrente` que o teste de unidade das frentes exercita — uma
    // segunda cópia da regra divergiria, e a que divergisse acordaria o fluxo
    // de outra pessoa.
    const mundo = adminFalso([frente({ awaiting_match: { conversation_id: "c1" } })]);
    const r = await acordarFrentesQueEsperam(mundo.admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "message.received",
      payload: { conversation_id: "OUTRA" },
    });

    expect(r.status).toBe("skipped");
    expect(mundo.updates).toHaveLength(0);
  });

  it("evento que ninguém espera não escreve nada", async () => {
    // O caso esmagadoramente comum: a maioria dos eventos do sistema não tem
    // frente nenhuma dormindo por eles.
    const mundo = adminFalso([]);
    const r = await acordarFrentesQueEsperam(mundo.admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "message.received",
      payload: {},
    });

    expect(r.status).toBe("skipped");
    expect(mundo.updates).toHaveLength(0);
  });

  it("o update só alcança quem AINDA espera", async () => {
    // Dois eventos chegando juntos: o segundo tem de encontrar zero linhas em
    // vez de reescrever o estado que o primeiro acabou de gravar.
    const mundo = adminFalso([frente()]);
    await acordarFrentesQueEsperam(mundo.admin, {
      id: "ev-1",
      organization_id: ORG,
      event_type: "message.received",
      payload: {},
    });

    const daFrente = mundo.updates.find((u) => u.tabela === "flow_execution_frames")!;
    expect(daFrente.filtros.status).toBe("waiting");
    expect(daFrente.filtros.awaiting_event_type).toBe("message.received");
  });
});
