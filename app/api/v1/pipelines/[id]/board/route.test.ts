import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A abertura do quadro (PR "Kanbans"): o GET não traz mais todo o histórico de
 * negócios fechados, traz as tags do CONTATO no mesmo select e junta os
 * enriquecimentos (rodados em paralelo) sem perder nenhum.
 */

type Resposta = { data: unknown; error: unknown };
const chamadas: Array<{ tabela: string; metodo: string; args: unknown[] }> = [];
let respostas: Record<string, Resposta> = {};

function consulta(tabela: string) {
  const q: Record<string, unknown> = {};
  const registra =
    (metodo: string) =>
    (...args: unknown[]) => {
      chamadas.push({ tabela, metodo, args });
      return q;
    };
  for (const m of ["select", "eq", "neq", "or", "in", "not", "order", "limit", "gte"]) q[m] = registra(m);
  const r = () => respostas[tabela] ?? { data: [], error: null };
  q.maybeSingle = async () => r();
  q.then = (res: (v: Resposta) => unknown) => Promise.resolve(r()).then(res);
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } }, error: null }) },
    from: (t: string) => consulta(t),
    rpc: async () => ({ data: null, error: null }),
  })),
}));

import { NextRequest } from "next/server";

import { GET } from "./route";

const ORG = "org-1";
const PIPE = "pipe-1";

function req(qs = "") {
  return new NextRequest(`http://x/api/v1/pipelines/${PIPE}/board${qs}`);
}

beforeEach(() => {
  chamadas.length = 0;
  respostas = {
    crm_pipelines: { data: { id: PIPE, organization_id: ORG, name: "Vendas" }, error: null },
    crm_stages: { data: [{ id: "s-1", name: "Novo" }], error: null },
    crm_leads: {
      data: [
        {
          id: "l-1",
          contact_id: "c-1",
          tags: ["Orçamento"],
          owner_kind: null,
          contato: { display_name: "Maria", name: null, tags: ["VIP"] },
        },
      ],
      error: null,
    },
    conversations: {
      data: [{ id: "cv-1", contact_id: "c-1", last_message_preview: "oi", last_message_at: "2026-10-01T00:00:00Z", unread_count: 2 }],
      error: null,
    },
  };
});

describe("GET /pipelines/[id]/board", () => {
  it("abertos sempre, fechados só dos últimos 30 dias (antes vinha TODO o histórico)", async () => {
    const antes = Date.now();
    await GET(req(), { params: Promise.resolve({ id: PIPE }) });
    const or = chamadas.find((c) => c.tabela === "crm_leads" && c.metodo === "or");
    expect(or).toBeDefined();
    const filtro = String(or!.args[0]);
    expect(filtro.startsWith("status.eq.open,closed_at.gte.")).toBe(true);
    const desde = Date.parse(filtro.replace("status.eq.open,closed_at.gte.", ""));
    const dias = (antes - desde) / 86_400_000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThan(30.1);
    expect(chamadas.some((c) => c.tabela === "crm_leads" && c.metodo === "neq")).toBe(false);
  });

  it("?fechados_dias amplia, com teto de 365", async () => {
    await GET(req("?fechados_dias=9999"), { params: Promise.resolve({ id: PIPE }) });
    const filtro = String(chamadas.find((c) => c.metodo === "or")!.args[0]);
    const dias = (Date.now() - Date.parse(filtro.split("closed_at.gte.")[1]!)) / 86_400_000;
    expect(Math.round(dias)).toBe(365);
  });

  it("traz nome e tags do CONTATO no lead e mantém a conversa do enriquecimento", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: PIPE }) });
    const corpo = (await res.json()) as { data: { leads: Array<Record<string, unknown>> } };
    const lead = corpo.data.leads[0]!;
    expect(lead.contact_name).toBe("Maria");
    expect(lead.contact_tags).toEqual(["VIP"]);
    expect(lead.tags).toEqual(["Orçamento"]);
    expect("contato" in lead).toBe(false);
    expect(lead.conversa).toMatchObject({ id: "cv-1" });
    const select = chamadas.find((c) => c.tabela === "crm_leads" && c.metodo === "select");
    expect(String(select!.args[0])).toContain("contato:contacts(");
  });
});
