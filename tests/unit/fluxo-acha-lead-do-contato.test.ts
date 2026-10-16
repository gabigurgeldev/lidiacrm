import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import type { FlowExecutionRow } from "@/lib/flow-engine/engine";
import { criarFlowAdminClient } from "@/lib/flow-engine/supabase-adapter";

/**
 * FLUXO DE MENSAGEM RECEBIDA ENXERGA O LEAD DO CONTATO.
 *
 * Medido em produção (EDUCATEC, 2026-10-16): fluxo "mensagem do anúncio →
 * distribuir na fila → se ninguém disponível, avisar o gerente". A execução
 * nascia com `lead_id` nulo (o evento é da MENSAGEM), o bloco de distribuição
 * morria em `sem_lead_para_distribuir` — com o contato tendo lead aberto — e o
 * ramo "Ninguém disponível" nunca chegava a avisar ninguém.
 */

const ORG = "org-1";
const CONTATO = "contato-1";
const LEAD = "lead-aberto";

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
    lead_id: null,
    contact_id: CONTATO,
    conversation_id: null,
    started_at: new Date().toISOString(),
    input: {},
    output: {},
    ...extra,
  } as FlowExecutionRow;
}

/** Banco que responde pelos FILTROS aplicados — é a busca que está sob teste. */
function banco(opts: { leadAberto: boolean }) {
  const buscasPorContato: Array<Record<string, unknown>> = [];

  function builder(tabela: string) {
    const filtros: Record<string, unknown> = {};
    const resolver = () => {
      if (tabela === "crm_leads" && "contact_id" in filtros) {
        buscasPorContato.push({ ...filtros });
        return { data: opts.leadAberto ? { id: LEAD } : null, error: null };
      }
      if (tabela === "crm_leads" && filtros.id === LEAD) {
        return {
          data: {
            id: LEAD,
            title: "Gabriel Gurgel",
            status: "open",
            stage_id: "",
            pipeline_id: "p-1",
            owner_user_id: null,
            value_cents: null,
            source: "whatsapp",
            tags: [],
            custom_fields: {},
            contact_id: CONTATO,
            created_at: "2026-10-16T21:54:19Z",
          },
          error: null,
        };
      }
      if (tabela === "contacts") {
        return {
          data: { id: CONTATO, name: "Gabriel", display_name: null, phone_number: "+5594981004900", email: null, tags: [], is_blocked: false },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const b: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, chave: string) {
          if (chave === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve(resolver()).then(res, rej);
          }
          if (chave === "maybeSingle" || chave === "single") return async () => resolver();
          return (...args: unknown[]) => {
            if (chave === "eq") filtros[String(args[0])] = args[1];
            return b;
          };
        },
      },
    );
    return b;
  }

  const admin = {
    from: (tabela: string) => builder(tabela),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  };
  return { admin, buscasPorContato };
}

describe("carregarFatos — execução sem lead_id", () => {
  it("usa o lead ABERTO do contato, na org da execução", async () => {
    const db = banco({ leadAberto: true });
    const fatos = await criarFlowAdminClient(db.admin as never).carregarFatos(ORG, exec());

    expect(fatos.lead?.id).toBe(LEAD);
    expect(fatos.contact?.id).toBe(CONTATO);
    expect(db.buscasPorContato).toEqual([
      { organization_id: ORG, contact_id: CONTATO, status: "open" },
    ]);
  });

  it("contato sem lead aberto segue sem lead (o bloco decide o que fazer)", async () => {
    const db = banco({ leadAberto: false });
    const fatos = await criarFlowAdminClient(db.admin as never).carregarFatos(ORG, exec());
    expect(fatos.lead).toBeNull();
    expect(fatos.contact?.id).toBe(CONTATO);
  });

  it("execução que JÁ tem lead não procura outro pelo contato", async () => {
    const db = banco({ leadAberto: true });
    const fatos = await criarFlowAdminClient(db.admin as never).carregarFatos(
      ORG,
      exec({ lead_id: LEAD }),
    );
    expect(fatos.lead?.id).toBe(LEAD);
    expect(db.buscasPorContato).toEqual([]);
  });

  it("sem contato nem lead não consulta nada", async () => {
    const db = banco({ leadAberto: true });
    const fatos = await criarFlowAdminClient(db.admin as never).carregarFatos(
      ORG,
      exec({ contact_id: null }),
    );
    expect(fatos.lead).toBeNull();
    expect(db.buscasPorContato).toEqual([]);
  });
});
