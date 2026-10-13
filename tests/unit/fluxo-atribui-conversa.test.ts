import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { logger } from "@/lib/logger";
import type { FlowExecutionRow } from "@/lib/flow-engine/engine";
import { criarPortas } from "@/lib/flow-engine/supabase-adapter";

/**
 * Distribuir pelo fluxo tem de dar a CONVERSA ao atendente, não só o lead.
 *
 * Enquanto `atribuirDono` gravava só `crm_leads.owner_user_id`, o atendente
 * sorteado não via a conversa na caixa de entrada dele, e `routing.round_robin`
 * nunca girava — a rotação conta `conversation_assignment_events`, que só a
 * `fn_conversation_assign` escreve.
 */

const ORG = "org-1";

function exec(extra: Partial<FlowExecutionRow> = {}): FlowExecutionRow {
  return {
    id: "exec-1",
    organization_id: ORG,
    flow_id: "fluxo-1",
    version_id: "v-1",
    status: "running",
    current_node_id: "n1",
    next_eval_at: null,
    attempts: 0,
    max_attempts: 3,
    steps_taken: 0,
    context: {},
    lead_id: "lead-1",
    contact_id: null,
    conversation_id: null,
    started_at: new Date().toISOString(),
    ...extra,
  } as FlowExecutionRow;
}

function bancoDeMentira(opts: { conversa?: string | null; rpcErro?: string } = {}) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const filtrosDaConversa: Array<{ metodo: string; args: unknown[] }> = [];

  function builder(tabela: string) {
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, chave: string) {
          const resolver = () => {
            if (tabela === "crm_leads") return { data: { contact_id: "contato-1" }, error: null };
            if (tabela === "conversations")
              return { data: opts.conversa === null ? null : { id: opts.conversa ?? "conversa-1" }, error: null };
            return { data: null, error: null };
          };
          if (chave === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(resolver()).then(res, rej);
          }
          if (chave === "maybeSingle" || chave === "single") return async () => resolver();
          return (...args: unknown[]) => {
            if (tabela === "conversations") filtrosDaConversa.push({ metodo: chave, args });
            return b;
          };
        },
      },
    );
    return b;
  }

  const admin = {
    from: (tabela: string) => builder(tabela),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return opts.rpcErro ? { data: null, error: { message: opts.rpcErro } } : { data: [{}], error: null };
    },
  };
  return { admin, rpcs, filtrosDaConversa };
}

describe("atribuirDono do fluxo", () => {
  it("atribui a conversa viva do contato do lead pela fn_conversation_assign", async () => {
    const db = bancoDeMentira();
    await criarPortas(db.admin as never, exec()).crm.atribuirDono({ leadId: "lead-1", userId: "user-x" });

    expect(db.rpcs).toEqual([
      {
        fn: "fn_conversation_assign",
        args: {
          p_organization_id: ORG,
          p_conversation_id: "conversa-1",
          p_to_user_id: "user-x",
          p_reason: "routing",
          p_expected_assignee: null,
          p_enforce_expected: false,
        },
      },
    ]);
    expect(db.filtrosDaConversa).toEqual(
      expect.arrayContaining([
        { metodo: "eq", args: ["organization_id", ORG] },
        { metodo: "eq", args: ["contact_id", "contato-1"] },
      ]),
    );
  });

  it("usa a conversa da execução quando o gatilho a trouxe, sem procurar", async () => {
    const db = bancoDeMentira();
    await criarPortas(db.admin as never, exec({ conversation_id: "conversa-do-gatilho" })).crm.atribuirDono({
      leadId: "lead-1",
      userId: "user-x",
    });
    expect(db.rpcs[0]?.args.p_conversation_id).toBe("conversa-do-gatilho");
    expect(db.filtrosDaConversa).toHaveLength(0);
  });

  it("sem conversa viva, só o lead ganha dono", async () => {
    const db = bancoDeMentira({ conversa: null });
    await criarPortas(db.admin as never, exec()).crm.atribuirDono({ leadId: "lead-1", userId: "user-x" });
    expect(db.rpcs).toHaveLength(0);
  });

  it("falha ao atribuir a conversa avisa e não derruba o bloco", async () => {
    const db = bancoDeMentira({ rpcErro: "assignee_not_eligible_member" });
    await expect(
      criarPortas(db.admin as never, exec()).crm.atribuirDono({ leadId: "lead-1", userId: "user-x" }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      "flow_engine.conversa_nao_atribuida",
      expect.objectContaining({ erro: "assignee_not_eligible_member" }),
    );
  });
});
