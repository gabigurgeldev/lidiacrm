/**
 * QUANDO A PASSAGEM VIRA AVISO AO DONO — os dois motores.
 *
 * A regra pura (`deveAnunciarPassagem`) e o motor do CRM (`triggerHandoff`),
 * que até aqui nunca gravava `agent.handoff_requested`: a passagem por
 * sentimento ou pelo MCP não chegava ao fluxo "Quando a IA passar para uma
 * pessoa", e o item que ela abria ainda calava o aviso da passagem seguinte.
 * O motor de conversa é coberto em `handoff-emite-evento-do-fluxo.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COOLDOWN_DO_ANUNCIO_MS, deveAnunciarPassagem } from "@/lib/escalacao/anuncio-da-passagem";

describe("deveAnunciarPassagem", () => {
  const agora = new Date("2026-10-07T12:00:00Z");

  it.each([
    { caso: "fora de passagem, nunca avisado", estavaEmPassagem: false, itemDaCentralNasceu: false, ultimo: null, esperado: true },
    { caso: "fora de passagem com item velho aberto (o defeito)", estavaEmPassagem: false, itemDaCentralNasceu: false, ultimo: new Date("2026-10-01T00:00:00Z"), esperado: true },
    { caso: "já em passagem (retry do mesmo episódio)", estavaEmPassagem: true, itemDaCentralNasceu: false, ultimo: null, esperado: false },
    { caso: "em passagem mas o cartão nasceu agora", estavaEmPassagem: true, itemDaCentralNasceu: true, ultimo: null, esperado: true },
    { caso: "dois motores no mesmo segundo", estavaEmPassagem: false, itemDaCentralNasceu: true, ultimo: new Date(agora.getTime() - 1_000), esperado: false },
    { caso: "cooldown vencido", estavaEmPassagem: false, itemDaCentralNasceu: false, ultimo: new Date(agora.getTime() - COOLDOWN_DO_ANUNCIO_MS), esperado: true },
  ])("$caso → $esperado", ({ estavaEmPassagem, itemDaCentralNasceu, ultimo, esperado }) => {
    expect(deveAnunciarPassagem({ estavaEmPassagem, itemDaCentralNasceu, ultimoAnuncioEm: ultimo, agora })).toBe(esperado);
  });
});

// ─── triggerHandoff (supabase-js) ──────────────────────────────────────────

type Estado = { forceHuman: boolean; silenciadas: number; ultimoAnuncio: string | null; itemAberto: boolean };
let estado: Estado;
let rpcs: Array<{ fn: string; args: Record<string, unknown> }>;
let updatesDaCentral: number;

function consulta(tabela: string) {
  const filtros: Record<string, unknown> = {};
  let operacao: "select" | "update" | "insert" = "select";
  const q: Record<string, unknown> = {};
  const resolver = () => {
    if (operacao === "update") {
      if (tabela === "agent_inbox_items") updatesDaCentral += 1;
      return { data: null, error: null };
    }
    if (operacao === "insert") return { data: null, error: null };
    if (tabela === "conversations" && "id" in filtros) {
      return { data: { id: "conv-1", organization_id: "org-1", contact_id: "ct-1", last_handoff_at: null, last_handoff_reason: null }, error: null };
    }
    if (tabela === "conversations") return { data: null, count: estado.silenciadas, error: null };
    if (tabela === "contacts") return { data: { force_human: estado.forceHuman }, error: null };
    if (tabela === "event_log") return { data: estado.ultimoAnuncio ? { created_at: estado.ultimoAnuncio } : null, error: null };
    if (tabela === "agent_inbox_items") return { data: estado.itemAberto ? { id: "item-1" } : null, error: null };
    return { data: null, error: null };
  };
  Object.assign(q, {
    select: () => q,
    update: () => ((operacao = "update"), q),
    insert: () => ((operacao = "insert"), Promise.resolve(resolver())),
    eq: (col: string, val: unknown) => ((filtros[col] = val), q),
    is: () => q,
    order: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve(resolver()),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok),
  });
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => consulta(t),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return { data: null, error: null };
    },
    channel: () => ({ send: async () => undefined }),
    removeChannel: async () => undefined,
  }),
}));
vi.mock("@/lib/ai/handoff/aviso-ao-lead", () => ({
  avisarLeadDoCrm: async () => ({ avisado: true }),
}));

const { triggerHandoff } = await import("@/lib/ai/handoff/orchestrator");

function anuncios() {
  return rpcs.filter((r) => r.fn === "emit_event" && r.args.p_event_type === "agent.handoff_requested");
}

describe("triggerHandoff → agent.handoff_requested", () => {
  beforeEach(() => {
    estado = { forceHuman: false, silenciadas: 0, ultimoAnuncio: null, itemAberto: false };
    rpcs = [];
    updatesDaCentral = 0;
  });

  it("passagem por sentimento avisa o dono (antes: só ai.handoff_triggered, que fluxo nenhum escuta)", async () => {
    const r = await triggerHandoff({ conversationId: "conv-1", organizationId: "org-1", reason: "low_sentiment", leadId: "lead-1" });

    expect(r.triggered).toBe(true);
    expect(anuncios()).toHaveLength(1);
    const args = anuncios()[0]!.args;
    expect(args.p_entity_kind).toBe("crm_lead");
    expect(args.p_entity_id).toBe("lead-1");
    expect(args.p_payload).toMatchObject({ contact_id: "ct-1", conversation_id: "conv-1", reason: "low_sentiment", lead_avisado: true });
    // O par antigo continua — follow-up e contadores dependem dele.
    expect(rpcs.some((x) => x.args.p_event_type === "ai.handoff_triggered")).toBe(true);
  });

  it("item velho aberto de contato fora de passagem: encerra o resíduo e avisa", async () => {
    estado.itemAberto = true;

    await triggerHandoff({ conversationId: "conv-1", organizationId: "org-1", reason: "low_sentiment" });

    expect(updatesDaCentral).toBe(1);
    expect(anuncios()).toHaveLength(1);
  });

  it("contato já em passagem: sem aviso novo e sem mexer no cartão", async () => {
    estado = { forceHuman: true, silenciadas: 1, ultimoAnuncio: null, itemAberto: true };

    await triggerHandoff({ conversationId: "conv-1", organizationId: "org-1", reason: "low_sentiment" });

    expect(updatesDaCentral).toBe(0);
    expect(anuncios()).toHaveLength(0);
  });
});
