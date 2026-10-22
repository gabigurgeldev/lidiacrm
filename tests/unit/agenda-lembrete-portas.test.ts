/**
 * AS PORTAS REAIS DO LEMBRETE (`lib/agenda/lembrete/supabase.ts`) — os filtros
 * que o motor não enxerga.
 *
 * O motor tem suíte própria com dublês; aqui a pergunta é o que vai ao banco:
 *
 *   - `confirmar` só grava o ponteiro no agendamento AINDA confirmado no MESMO
 *     horário reivindicado; zero linhas → a mensagem recém-enfileirada é
 *     cancelada (enquanto `scheduled`, na organização da linha);
 *   - o varredor de presas pede reivindicadas há mais de 15 min, sem ponteiro e
 *     sem motivo, e a marcação é condicional (uma rodada só ganha);
 *   - toda escrita filtra `organization_id` (o client é service role).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";

import { MINUTOS_ATE_PRESO, type AgendamentoParaLembrete } from "@/lib/agenda/lembrete/motor";
import { portasDoLembrete } from "@/lib/agenda/lembrete/supabase";

interface Chamada {
  tabela: string;
  update?: Record<string, unknown>;
  filtros: [string, string, unknown][];
}

let chamadas: Chamada[];
/** O que cada tabela devolve, na ordem das chamadas a ela. */
let respostas: Record<string, { data: unknown; error: { message: string } | null }[]>;

function client(): SupabaseClient {
  return {
    from(tabela: string) {
      const c: Chamada = { tabela, filtros: [] };
      chamadas.push(c);
      const b: Record<string, unknown> = {};
      const filtro = (op: string) => (col: string, a: unknown, v?: unknown) => {
        c.filtros.push([op, col, v === undefined ? a : [a, v]]);
        return b;
      };
      for (const op of ["eq", "in", "is", "not", "lt", "gt", "lte", "gte"]) b[op] = filtro(op);
      b.select = () => b;
      b.order = () => b;
      b.limit = () => b;
      b.update = (v: Record<string, unknown>) => {
        c.update = v;
        return b;
      };
      b.then = (ok: (v: unknown) => unknown) =>
        Promise.resolve((respostas[tabela] ?? []).shift() ?? { data: [], error: null }).then(ok);
      return b;
    },
  } as unknown as SupabaseClient;
}

const AGORA = new Date("2026-10-22T12:00:00Z");
const AG: AgendamentoParaLembrete = {
  id: "ag-1",
  organization_id: "org-1",
  starts_at: "2026-10-23T08:00:00+00:00",
  booked_at: "2026-10-01T08:00:00+00:00",
  status: "confirmed",
  time_zone: "America/Sao_Paulo",
  contact_id: "c-1",
  conversation_id: "conv-1",
  reminder_sent_at: null,
  reminder_skipped_reason: null,
  tipo: { nome: "Consulta", reminder_enabled: true, reminder_minutes_before: 1440 },
};

function tem(c: Chamada | undefined, op: string, col: string, v?: unknown): boolean {
  return Boolean(c?.filtros.some(([o, k, val]) => o === op && k === col && (v === undefined || val === v)));
}

beforeEach(() => {
  chamadas = [];
  respostas = {};
});

describe("confirmar", () => {
  it("grava o ponteiro só no agendamento ainda confirmado no MESMO horário", async () => {
    respostas.calendar_appointments = [{ data: [{ id: "ag-1" }], error: null }];
    const gravou = await portasDoLembrete(client()).confirmar(AG, "msg-1");
    expect(gravou).toBe(true);
    const upd = chamadas.find((c) => c.tabela === "calendar_appointments");
    expect(upd?.update).toEqual({ reminder_scheduled_message_id: "msg-1" });
    expect(tem(upd, "eq", "organization_id", "org-1")).toBe(true);
    expect(tem(upd, "eq", "status", "confirmed")).toBe(true);
    expect(tem(upd, "eq", "starts_at", AG.starts_at)).toBe(true);
    expect(tem(upd, "is", "reminder_scheduled_message_id")).toBe(true);
    // Sem nada a cancelar: a fila não foi tocada.
    expect(chamadas.some((c) => c.tabela === "conversation_scheduled_messages")).toBe(false);
  });

  it("⚠️ zero linhas (remarcado/cancelado no meio): cancela a mensagem e devolve false", async () => {
    respostas.calendar_appointments = [{ data: [], error: null }];
    respostas.conversation_scheduled_messages = [{ data: [{ id: "msg-1" }], error: null }];
    const gravou = await portasDoLembrete(client()).confirmar(AG, "msg-1");
    expect(gravou).toBe(false);
    const fila = chamadas.find((c) => c.tabela === "conversation_scheduled_messages");
    expect(fila?.update).toMatchObject({ status: "cancelled" });
    expect(tem(fila, "eq", "id", "msg-1")).toBe(true);
    expect(tem(fila, "eq", "organization_id", "org-1")).toBe(true);
    // Só `scheduled`: `queued`/`sending`/`sent` têm dono ou já saíram.
    expect(tem(fila, "eq", "status", "scheduled")).toBe(true);
  });

  it("erro ao gravar o ponteiro NÃO cancela — a mensagem está na fila e vale", async () => {
    respostas.calendar_appointments = [{ data: null, error: { message: "caiu" } }];
    const gravou = await portasDoLembrete(client()).confirmar(AG, "msg-1");
    expect(gravou).toBe(true);
    expect(chamadas.some((c) => c.tabela === "conversation_scheduled_messages")).toBe(false);
  });
});

describe("varredor de presas", () => {
  it("pede reivindicadas há mais de 15 min, sem ponteiro, sem motivo, confirmadas e por vir", async () => {
    respostas.calendar_appointments = [{ data: [{ id: "ag-9", organization_id: "org-2" }], error: null }];
    const presas = await portasDoLembrete(client()).presos(AGORA, 50);
    expect(presas).toEqual([{ id: "ag-9", organization_id: "org-2" }]);
    const q = chamadas[0];
    const corte = new Date(AGORA.getTime() - MINUTOS_ATE_PRESO * 60_000).toISOString();
    expect(tem(q, "not", "reminder_sent_at")).toBe(true);
    expect(tem(q, "lt", "reminder_sent_at", corte)).toBe(true);
    expect(tem(q, "is", "reminder_scheduled_message_id")).toBe(true);
    expect(tem(q, "is", "reminder_skipped_reason")).toBe(true);
    expect(tem(q, "eq", "status", "confirmed")).toBe(true);
    expect(tem(q, "gt", "starts_at", AGORA.toISOString())).toBe(true);
  });

  it("erro na varredura SOBE (o motor conta falha) em vez de virar 'nada preso'", async () => {
    respostas.calendar_appointments = [{ data: null, error: { message: "caiu" } }];
    await expect(portasDoLembrete(client()).presos(AGORA, 50)).rejects.toThrow(/varredor de presas/);
  });

  it("a marcação é condicional e grava o motivo do vocabulário", async () => {
    respostas.calendar_appointments = [{ data: [{ id: "ag-9" }], error: null }];
    const ganhou = await portasDoLembrete(client()).marcarPreso({ id: "ag-9", organization_id: "org-2" });
    expect(ganhou).toBe(true);
    const upd = chamadas[0];
    expect(upd?.update).toEqual({ reminder_skipped_reason: "enfileiramento_interrompido" });
    expect(tem(upd, "eq", "organization_id", "org-2")).toBe(true);
    expect(tem(upd, "is", "reminder_skipped_reason")).toBe(true);
    expect(tem(upd, "is", "reminder_scheduled_message_id")).toBe(true);
  });

  it("outra rodada marcou antes: false", async () => {
    respostas.calendar_appointments = [{ data: [], error: null }];
    expect(await portasDoLembrete(client()).marcarPreso({ id: "ag-9", organization_id: "org-2" })).toBe(false);
  });
});
