/**
 * A TRIAGEM ENTREGA A CONVERSA À IA — COM O QUE COLETOU, E A IA FALA NA HORA.
 *
 * Três peças, três riscos:
 *  - o bloco: contexto interpolado vai à porta; "pessoa no comando" tem saída
 *    própria (não desfaz passagem feita no meio do fluxo);
 *  - o drain: o pedido do fluxo é IMEDIATO (sem o debounce) e, se já há job
 *    pendente da última resposta do cliente, MARCA esse job — senão ele seria
 *    calado pelo "fluxo no comando" e a IA nunca falaria;
 *  - o turno: lê a marca do payload.
 */
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";

import { drainTick } from "@/lib/agent-engine/edge/crm/drain";
import { crmHandoffToAgent, entregarAoAgenteConfigSchema } from "@/lib/flow-engine/nodes/distribuicao";
import type { FlowExecutionContext } from "@/lib/flow-engine/types";

describe("crm.handoff_to_agent com contexto", () => {
  function ctx(resposta: { ok: true; jaEstavaComOAgente: boolean } | { ok: false; motivo: string }) {
    const pedidos: unknown[] = [];
    const c = {
      fatos: { contact: { id: "ct-1" } },
      render: (t: string) => t.replace("{{vars.nome}}", "Maria"),
      crm: {
        devolverAoAgente: async (input: unknown) => {
          pedidos.push(input);
          return resposta;
        },
      },
    } as unknown as FlowExecutionContext;
    return { c, pedidos };
  }

  it("leva o contexto interpolado e pede o turno imediato", async () => {
    const { c, pedidos } = ctx({ ok: true, jaEstavaComOAgente: true });
    const cfg = entregarAoAgenteConfigSchema.parse({
      contexto: "Nome: {{vars.nome}}",
      iniciar_atendimento: true,
      nao_tirar_de_pessoa: true,
    });
    const r = await crmHandoffToAgent.execute(c, cfg);
    expect(pedidos).toEqual([
      { contactId: "ct-1", contexto: "Nome: Maria", iniciarAtendimento: true, naoTirarDePessoa: true },
    ]);
    expect(r).toMatchObject({ kind: "advance", branch_id: "else" });
  });

  it("config vazio (fluxo já publicado) pede exatamente o de antes", async () => {
    const { c, pedidos } = ctx({ ok: true, jaEstavaComOAgente: false });
    await crmHandoffToAgent.execute(c, entregarAoAgenteConfigSchema.parse({}));
    expect(pedidos).toEqual([{ contactId: "ct-1" }]);
  });

  it("pessoa no comando segue pela saída própria, não por 'sem conversa'", async () => {
    const { c } = ctx({ ok: false, motivo: "pessoa_no_comando" });
    const r = await crmHandoffToAgent.execute(c, entregarAoAgenteConfigSchema.parse({ nao_tirar_de_pessoa: true }));
    expect(r).toMatchObject({ kind: "advance", branch_id: "pessoa_no_comando" });
  });
});

describe("drain: entrega do fluxo", () => {
  const knobs = { batchSize: 10, intervalMs: 0, idleIntervalMs: 0, debounceMs: 8000, reapTimeoutMs: 60000 };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
  const EXEC = "55555555-5555-4555-8555-555555555555";
  const evento = {
    id: "e1",
    organization_id: "org1",
    attempts: 1,
    created_at: new Date().toISOString(),
    payload: {
      conversation_id: "11111111-1111-4111-8111-111111111111",
      contact_id: "22222222-2222-4222-8222-222222222222",
      channel_session_id: "33333333-3333-4333-8333-333333333333",
      inbound_message_id: "44444444-4444-4444-8444-444444444444",
      entregue_por_fluxo: EXEC,
      imediato: true,
    },
  };

  function pool(jobPendente: boolean) {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = vi.fn().mockImplementation((sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("returning e.id")) return { rows: [evento] };
      if (sql.includes("ai_dispatch_mode")) return { rows: [{ mode: null }] };
      if (sql.includes("is_group")) return { rows: [{ is_group: false }] };
      if (sql.includes("tem_agente")) return { rows: [{ tem_agente: true, tem_roteador: false }] };
      if (sql.includes("media_derived_status")) return { rows: [{ type: "text", media_derived_status: null }] };
      if (sql.includes("entregue_por_fluxo") && sql.includes("update job_queue")) {
        return { rows: jobPendente ? [{ id: "job-pendente" }] : [] };
      }
      if (sql.includes("insert into job_queue")) return { rows: [{ id: "job-novo" }], rowCount: 1 };
      return { rows: [] };
    });
    return { p: { query } as unknown as pg.Pool, calls };
  }

  it("⭐ job pendente da última resposta é MARCADO e antecipado — não só carona", async () => {
    const { p, calls } = pool(true);
    await drainTick(p, knobs, log);
    const marca = calls.find((c) => c.sql.includes("update job_queue") && c.sql.includes("entregue_por_fluxo"));
    expect(marca, "a carona sem marca deixaria o job ser calado pelo fluxo").toBeDefined();
    expect(marca!.sql).toContain("least(run_after, now())");
    expect(calls.some((c) => c.sql.includes("insert into job_queue"))).toBe(false);
  });

  it("sem job pendente: enfileira JÁ (sem debounce) com a marca no payload", async () => {
    const { p, calls } = pool(false);
    await drainTick(p, knobs, log);
    const insert = calls.find((c) => c.sql.includes("insert into job_queue"));
    expect(insert, "nenhum turno foi pedido").toBeDefined();
    expect(JSON.stringify(insert!.params)).toContain(EXEC);
  });
});
