/**
 * POST /conversations/[id]/reopen — a volta de "Fechadas" para uma aba.
 *
 * Prova, contra o Route Handler REAL (auth, Supabase e a devolução mockados):
 *  - `minhas` assume pela RPC com reason='claim' e lock no dono LIDO;
 *  - `fila` solta pela RPC com reason='release' e lock no dono LIDO;
 *  - `automatico` REABRE antes de devolver (a devolução preserva encerrada);
 *  - conversa já aberta → 409, sem RPC e sem audit;
 *  - RPC sem linha (alguém mexeu no meio) → 409, sem audit;
 *  - destino fora do vocabulário → 422.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { createClient } from "@/lib/supabase/server";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import type { AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
  isServiceRoleConfigured: vi.fn(() => false),
}));
vi.mock("@/lib/escalacao/retomada", () => ({ devolverAtendimentoAoAgente: vi.fn() }));
vi.mock("@/lib/inbox/atividade-de-comando", () => ({
  registrarTrocaDeComando: vi.fn(async () => undefined),
}));

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const DONO_ANTIGO = "33333333-3333-4333-8333-333333333333";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONV_ID = "44444444-4444-4444-8444-444444444444";

interface Estado {
  conversa: Record<string, unknown> | null;
  assignRows: Array<Record<string, unknown>>;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  updates: Array<{ valores: Record<string, unknown>; filtroStatus: unknown }>;
  /** Ordem dos efeitos — prova que a reabertura vem ANTES da devolução. */
  ordem: string[];
}

function stubSupabase(e: Estado) {
  return {
    from: () => {
      let valores: Record<string, unknown> | null = null;
      let filtroStatus: unknown = null;
      const chain = {
        select: () => chain,
        update: (v: Record<string, unknown>) => {
          valores = v;
          return chain;
        },
        eq: () => chain,
        in: (_col: string, lista: unknown) => {
          filtroStatus = lista;
          return chain;
        },
        maybeSingle: async () => {
          if (valores) {
            e.updates.push({ valores, filtroStatus });
            e.ordem.push("update");
            return { data: { id: CONV_ID }, error: null };
          }
          return { data: e.conversa, error: null };
        },
      };
      return chain;
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      e.rpcCalls.push({ fn, args });
      return { data: e.assignRows, error: null };
    },
  };
}

function estado(over: Partial<Estado> = {}): Estado {
  return {
    conversa: {
      id: CONV_ID,
      organization_id: ORG_ID,
      contact_id: "c-1",
      status: "closed",
      assigned_to_user_id: DONO_ANTIGO,
    },
    assignRows: [{ id: CONV_ID, organization_id: ORG_ID }],
    rpcCalls: [],
    updates: [],
    ordem: [],
    ...over,
  };
}

function sessao(e: Estado) {
  const user: AuthUser = {
    id: AGENT_ID,
    email: "agent@example.com",
    full_name: null,
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG_ID, organization_name: "Org", role: "agent" }],
  };
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user,
    org: { orgId: ORG_ID, name: "Org", role: "agent" },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(createClient).mockResolvedValue(stubSupabase(e) as any);
  vi.mocked(devolverAtendimentoAoAgente).mockImplementation(async () => {
    e.ordem.push("devolver");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ok: true } as any;
  });
}

async function reabrir(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/v1/conversations/[id]/reopen/route");
  return POST(
    new NextRequest(`http://localhost/api/v1/conversations/${CONV_ID}/reopen`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: CONV_ID }) },
  );
}

const auditouReabertura = () =>
  vi.mocked(audit).mock.calls.some(([a]) => a.action === "conversation.reopened");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /reopen — cada destino é um caminho que já existe", () => {
  it("minhas → assume pela RPC (claim) com lock no dono lido", async () => {
    const e = estado();
    sessao(e);
    const res = await reabrir({ destino: "minhas" });
    expect(res.status).toBe(200);
    const call = e.rpcCalls.find((c) => c.fn === "fn_conversation_assign");
    expect(call?.args).toMatchObject({
      p_organization_id: ORG_ID,
      p_to_user_id: AGENT_ID,
      p_reason: "claim",
      p_expected_assignee: DONO_ANTIGO,
      p_enforce_expected: true,
    });
    expect(auditouReabertura()).toBe(true);
  });

  it("fila → solta pela RPC (release) com lock no dono lido", async () => {
    const e = estado();
    sessao(e);
    const res = await reabrir({ destino: "fila" });
    expect(res.status).toBe(200);
    const call = e.rpcCalls.find((c) => c.fn === "fn_conversation_assign");
    expect(call?.args).toMatchObject({
      p_to_user_id: null,
      p_reason: "release",
      p_expected_assignee: DONO_ANTIGO,
      p_enforce_expected: true,
    });
    expect(devolverAtendimentoAoAgente).not.toHaveBeenCalled();
  });

  it("automatico → reabre ANTES de devolver (a devolução não tira de encerrada)", async () => {
    const e = estado();
    sessao(e);
    const res = await reabrir({ destino: "automatico" });
    expect(res.status).toBe(200);
    expect(e.ordem.slice(0, 2)).toEqual(["update", "devolver"]);
    expect(e.updates[0]?.valores).toMatchObject({ status: "open" });
    // A guarda de corrida: só reabre o que ainda está encerrado.
    expect(e.updates[0]?.filtroStatus).toEqual(["closed", "archived"]);
    expect(e.rpcCalls).toHaveLength(0);
    expect(auditouReabertura()).toBe(true);
  });
});

describe("POST /reopen — recusas", () => {
  it("conversa já aberta → 409, sem mexer em nada", async () => {
    const e = estado();
    (e.conversa as Record<string, unknown>).status = "claimed";
    sessao(e);
    const res = await reabrir({ destino: "fila" });
    expect(res.status).toBe(409);
    expect(e.rpcCalls).toHaveLength(0);
    expect(auditouReabertura()).toBe(false);
  });

  it("alguém mexeu no meio (RPC sem linha) → 409, sem audit", async () => {
    const e = estado({ assignRows: [] });
    sessao(e);
    const res = await reabrir({ destino: "minhas" });
    expect(res.status).toBe(409);
    expect(auditouReabertura()).toBe(false);
  });

  it("conversa de outra org / inexistente → 404", async () => {
    const e = estado({ conversa: null });
    sessao(e);
    const res = await reabrir({ destino: "fila" });
    expect(res.status).toBe(404);
  });

  it("destino fora do vocabulário → 422", async () => {
    const e = estado();
    sessao(e);
    const res = await reabrir({ destino: "lixeira" });
    expect(res.status).toBe(422);
    expect(e.rpcCalls).toHaveLength(0);
  });
});
