/**
 * A PASSAGEM PARA HUMANO AVISA ANTES DE CALAR.
 *
 * `performHumanHandoff` não tem transação (recebe um pg.Pool; o retry é do job).
 * Na ordem antiga o 1º passo era `force_human` e o último o aviso na Central: se
 * o turno caísse no meio, a re-execução via `isLeadInHandoff` = true e saía antes
 * de criar o aviso — cliente calado e ninguém avisado.
 *
 * Este arquivo prende a ordem: aviso (insert em agent_inbox_items) antes do
 * silêncio da conversa, e o silêncio antes do `force_human`. E simula a queda:
 * se o silêncio da conversa falha, o aviso já existe e o `force_human` não foi
 * gravado (então a re-execução refaz a passagem inteira).
 *
 * O pool é falso: o que está sob teste é a ORDEM dos comandos, não o Postgres.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/leads/agent-activity", () => ({
  emitAgentActivityForContact: async () => ({ routed: false, reason: "teste" }),
}));
vi.mock("@/lib/agent-engine/cron/scheduler", () => ({
  cancelPendingCronsForLead: async () => undefined,
}));

import type pg from "pg";

import { performHumanHandoff } from "@/lib/agent-engine/agent/human-handoff";

function poolFalso(falharEm?: RegExp): { pool: pg.Pool; sqls: string[] } {
  const sqls: string[] = [];
  const pool = {
    query: async (sql: string) => {
      sqls.push(sql);
      if (falharEm && falharEm.test(sql)) throw new Error("conexão caiu");
      if (sql.includes("as em_passagem")) {
        return { rows: [{ em_passagem: false, ultimo_anuncio: null }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  } as unknown as pg.Pool;
  return { pool, sqls };
}

const log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;
const ids = { tenantId: "org-1", leadId: "contato-1", conversationId: "conversa-1" };
const opts = { reason: "requested_human", conversationSummary: "resumo", log };

const AVISO = /insert into agent_inbox_items/;
const SILENCIO = /update conversations/;
const FORCE_HUMAN = /update contacts set force_human = true/;

const posicao = (sqls: string[], rx: RegExp) => sqls.findIndex((s) => rx.test(s));

describe("performHumanHandoff — ordem dos passos", () => {
  it("cria o aviso na Central antes de calar a conversa, e cala antes do force_human", async () => {
    const { pool, sqls } = poolFalso();
    await performHumanHandoff(pool, ids, opts);

    const aviso = posicao(sqls, AVISO);
    const silencio = posicao(sqls, SILENCIO);
    const forceHuman = posicao(sqls, FORCE_HUMAN);
    expect(aviso).toBeGreaterThanOrEqual(0);
    expect(silencio).toBeGreaterThan(aviso);
    expect(forceHuman).toBeGreaterThan(silencio);
  });

  it("se calar a conversa falha, o aviso já existe e nada foi silenciado", async () => {
    const { pool, sqls } = poolFalso(SILENCIO);

    await expect(performHumanHandoff(pool, ids, opts)).rejects.toThrow("conexão caiu");

    expect(posicao(sqls, AVISO), "a queda deixou o cliente sem aviso na Central").toBeGreaterThanOrEqual(0);
    expect(
      posicao(sqls, FORCE_HUMAN),
      "force_human gravado antes da queda: a re-execução sairia por isLeadInHandoff sem refazer nada",
    ).toBe(-1);
  });
});
