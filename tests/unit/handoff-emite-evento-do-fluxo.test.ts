/**
 * A PASSAGEM PARA HUMANO VAI AO BARRAMENTO — UMA VEZ POR EPISÓDIO.
 *
 * `performHumanHandoff` não gravava nada em `event_log`, então nenhum fluxo
 * conseguia reagir à passagem: o dono só descobria abrindo a Central. O gatilho
 * `trigger.ai_handoff` escuta `agent.handoff_requested`, e este arquivo guarda
 * as duas metades do contrato:
 *
 *  - episódio NOVO (o contato não estava em passagem) → exatamente um evento,
 *    com o contato, a conversa, o motivo e o resumo que a mensagem do aviso usa
 *    — MESMO com um item velho aberto na Central, que era o defeito: o aviso só
 *    saía quando o insert do item entrava, e um item esquecido calava todas as
 *    passagens seguintes do mesmo cliente;
 *  - RE-EXECUÇÃO do mesmo episódio (a função é at-least-once) → nenhum evento.
 *    Sem isto, cada retry mandaria o mesmo aviso de novo ao WhatsApp do dono.
 *
 * O pool é falso: o que está sob teste é QUAIS comandos saem, não o Postgres.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/leads/agent-activity", () => ({
  emitAgentActivityForContact: async () => ({ routed: true, leadId: "lead-9" }),
}));
vi.mock("@/lib/agent-engine/cron/scheduler", () => ({
  cancelPendingCronsForLead: async () => undefined,
}));

import type pg from "pg";

import { performHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { buscarNo } from "@/lib/flow-engine/registry";

type Chamada = { sql: string; params: unknown[] };

function poolFalso(
  inboxEntrou: boolean,
  antes: { emPassagem?: boolean; ultimoAnuncio?: Date | null } = {},
): { pool: pg.Pool; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      chamadas.push({ sql, params });
      if (sql.includes("as em_passagem")) {
        return {
          rows: [{ em_passagem: antes.emPassagem ?? false, ultimo_anuncio: antes.ultimoAnuncio ?? null }],
          rowCount: 1,
        };
      }
      if (sql.includes("insert into agent_inbox_items")) {
        return { rows: [], rowCount: inboxEntrou ? 1 : 0 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as pg.Pool;
  return { pool, chamadas };
}

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

const ids = { tenantId: "org-1", leadId: "contato-1", conversationId: "conversa-1" };

function eventosDaPassagem(chamadas: Chamada[]): Chamada[] {
  return chamadas.filter((c) => c.sql.includes("insert into event_log") && c.sql.includes("agent.handoff_requested"));
}

describe("performHumanHandoff → agent.handoff_requested", () => {
  it("episódio novo grava UM evento com o que o aviso precisa", async () => {
    const { pool, chamadas } = poolFalso(true);

    await performHumanHandoff(pool, ids, {
      reason: "requested_human",
      conversationSummary: "Cliente do Radar não consegue conectar o número.",
      avisoAoLead: { avisado: true },
      log,
    });

    const eventos = eventosDaPassagem(chamadas);
    expect(eventos, "a passagem não chegou ao barramento: nenhum fluxo consegue reagir").toHaveLength(1);
    const [orgId, entityKind, entityId, payloadJson] = eventos[0]!.params as [string, string, string, string];
    expect(orgId).toBe("org-1");
    // Com negócio roteado, o evento aponta o lead — é o que carrega os fatos do lead no fluxo.
    expect(entityKind).toBe("crm_lead");
    expect(entityId).toBe("lead-9");
    expect(JSON.parse(payloadJson)).toEqual({
      contact_id: "contato-1",
      conversation_id: "conversa-1",
      lead_id: "lead-9",
      reason: "requested_human",
      summary: "Cliente do Radar não consegue conectar o número.",
      lead_avisado: true,
    });
  });

  it("re-execução do mesmo episódio (contato já em passagem) NÃO grava outro evento", async () => {
    const { pool, chamadas } = poolFalso(false, { emPassagem: true });

    await performHumanHandoff(pool, ids, {
      reason: "requested_human",
      conversationSummary: "x",
      log,
    });

    expect(eventosDaPassagem(chamadas), "retry dispararia o aviso ao dono de novo").toHaveLength(0);
  });

  it("item VELHO aberto na Central não cala a passagem nova do mesmo cliente", async () => {
    // O defeito de produção: devolvido à IA sem o item ser fechado, o cliente
    // escalou de novo — o insert do item não entrou, e o dono nunca soube.
    const { pool, chamadas } = poolFalso(false, { emPassagem: false });

    await performHumanHandoff(pool, ids, { reason: "requested_human", conversationSummary: "x", log });

    expect(eventosDaPassagem(chamadas), "o dono não foi avisado da passagem nova").toHaveLength(1);
    const encerrouResiduo = chamadas.some(
      (c) => c.sql.includes("update agent_inbox_items") && c.sql.includes("'resolved'"),
    );
    expect(encerrouResiduo, "o cartão do episódio vencido continuou escondendo o novo").toBe(true);
  });

  it("dentro do cooldown, um segundo motor não duplica o aviso", async () => {
    const { pool, chamadas } = poolFalso(true, {
      emPassagem: false,
      ultimoAnuncio: new Date(Date.now() - 5_000),
    });

    await performHumanHandoff(pool, ids, { reason: "low_sentiment", conversationSummary: "x", log });

    expect(eventosDaPassagem(chamadas)).toHaveLength(0);
  });

  it("contato em passagem não tem o cartão aberto encerrado", async () => {
    const { pool, chamadas } = poolFalso(false, { emPassagem: true });

    await performHumanHandoff(pool, ids, { reason: "requested_human", conversationSummary: "x", log });

    expect(chamadas.some((c) => c.sql.includes("update agent_inbox_items"))).toBe(false);
  });

  it("o gatilho de fluxo escuta exatamente o evento que a passagem grava", () => {
    garantirNosRegistrados();
    expect(buscarNo("trigger.ai_handoff")?.eventos).toEqual(["agent.handoff_requested"]);
  });
});
