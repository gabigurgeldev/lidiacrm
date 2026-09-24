import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verifyInviteToken } from "@/lib/auth/invite-token";
import { assinar, conferirAssinatura } from "./assinatura";
import {
  alterarPlano,
  alternarSuspensao,
  assinaturas,
  criarTenant,
  estatisticas,
  type PedidoDeTenant,
} from "./tenants";

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/branding/saida", () => ({ marcaDaSaida: vi.fn(async () => ({ nome: "CRM" })) }));
vi.mock("@/lib/email/templates/invite", () => ({
  buildInviteEmail: vi.fn(() => ({ subject: "convite", html: "<p>convite</p>", text: "convite" })),
}));
vi.mock("@/lib/email/resend", () => ({
  sendEmail: vi.fn(async () => ({ ok: false, error: "not_configured" })),
}));

/**
 * Dublê mínimo do client do Supabase: guarda linhas por tabela e entende só o que
 * `lib/backoffice/tenants.ts` usa (eq, gte, order, limit, maybeSingle, single e o
 * embed `organizations(status)`). O unique de `request_id` é simulado, porque é
 * ele que sustenta a idempotência.
 */
type Linha = Record<string, unknown>;
function fakeSupabase() {
  const tabelas: Record<"organizations" | "backoffice_tenants" | "event_log", Linha[]> = {
    organizations: [],
    backoffice_tenants: [],
    event_log: [],
  };
  let seq = 0;

  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: "select" | "insert" | "update" | "delete" = "select";
    let colunas = "*";
    let payload: Linha = {};
    let limite = Infinity;

    const embed = (l: Linha) => {
      if (!colunas.includes("organizations(")) return l;
      const org = tabelas.organizations.find((o) => o.id === l.organization_id);
      return { ...l, organizations: org ? { status: org.status } : null };
    };

    function executar() {
      const alvo = tabelas[tabela as keyof typeof tabelas];
      if (op === "insert") {
        if (
          tabela === "backoffice_tenants" &&
          alvo.some((l) => l.request_id === payload.request_id)
        ) {
          return { data: null, error: { code: "23505", message: "duplicate request_id" } };
        }
        const linha = {
          id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
          updated_at: new Date(seq * 1000).toISOString(),
          ...payload,
        };
        alvo.push(linha);
        return { data: [linha], error: null };
      }
      const achadas = alvo.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") achadas.forEach((l) => Object.assign(l, payload));
      if (op === "delete")
        tabelas[tabela as keyof typeof tabelas] = alvo.filter((l) => !achadas.includes(l));
      return { data: achadas.slice(0, limite).map(embed), error: null };
    }

    const b = {
      select(c = "*") {
        colunas = c;
        return b;
      },
      insert(row: Linha) {
        op = "insert";
        payload = row;
        return b;
      },
      update(row: Linha) {
        op = "update";
        payload = row;
        return b;
      },
      delete() {
        op = "delete";
        return b;
      },
      eq(col: string, val: unknown) {
        filtros.push((l) => l[col] === val);
        return b;
      },
      gte(col: string, val: string) {
        filtros.push((l) => String(l[col]) >= val);
        return b;
      },
      order() {
        return b;
      },
      limit(n: number) {
        limite = n;
        return b;
      },
      async maybeSingle() {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      async single() {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(executar()).then(resolve, reject);
      },
    };
    return b;
  }

  return { client: { from } as unknown as SupabaseClient, tabelas };
}

const pedido = (over: Partial<PedidoDeTenant> = {}): PedidoDeTenant => ({
  request_id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  company_name: "Padaria Pão Quente",
  document: "11222333000181",
  owner: { name: "Maria", email: "maria@padaria.com", whatsapp: "5511988887777" },
  plan: "Pro",
  amount_cents: 29700,
  affiliate_code: "RAFA23",
  ...over,
});

describe("assinatura do Back Office", () => {
  const agoraMs = 1_790_000_000_000;
  const ts = String(agoraMs / 1000);

  it("aceita HMAC certo e recusa errado, expirado, ausente e sem segredo", () => {
    const sig = assinar("segredo", ts, '{"a":1}');
    expect(
      conferirAssinatura({
        segredo: "segredo",
        timestamp: ts,
        assinatura: sig,
        corpo: '{"a":1}',
        agoraMs,
      }),
    ).toEqual({ ok: true });
    expect(
      conferirAssinatura({
        segredo: "segredo",
        timestamp: ts,
        assinatura: sig,
        corpo: '{"a":2}',
        agoraMs,
      }),
    ).toMatchObject({ motivo: "invalida" });
    expect(
      conferirAssinatura({
        segredo: "outro",
        timestamp: ts,
        assinatura: sig,
        corpo: '{"a":1}',
        agoraMs,
      }),
    ).toMatchObject({ motivo: "invalida" });
    expect(
      conferirAssinatura({
        segredo: "segredo",
        timestamp: ts,
        assinatura: sig,
        corpo: '{"a":1}',
        agoraMs: agoraMs + 301_000,
      }),
    ).toMatchObject({ motivo: "expirada" });
    expect(
      conferirAssinatura({
        segredo: "segredo",
        timestamp: null,
        assinatura: sig,
        corpo: "",
        agoraMs,
      }),
    ).toMatchObject({ motivo: "ausente" });
    expect(
      conferirAssinatura({ segredo: "", timestamp: ts, assinatura: sig, corpo: "", agoraMs }),
    ).toMatchObject({ motivo: "sem_segredo" });
  });
});

describe("tenants do Back Office", () => {
  let db: ReturnType<typeof fakeSupabase>;
  beforeEach(() => {
    db = fakeSupabase();
  });

  it("cria organização + vínculo e devolve link de convite admin para o dono", async () => {
    const r = await criarTenant(db.client, pedido(), "https://crm.exemplo.com/");
    expect(r.status).toBe(201);
    const body = r.body as { external_tenant_id: string; access_url: string };

    const org = db.tabelas.organizations[0]!;
    expect(org).toMatchObject({
      id: body.external_tenant_id,
      display_name: "Padaria Pão Quente",
      cnpj: "11222333000181",
      status: "active",
    });
    expect(String(org.slug)).toMatch(/^padaria-pao-quente-[0-9a-f]{6}$/);
    expect(db.tabelas.backoffice_tenants[0]).toMatchObject({
      organization_id: org.id,
      affiliate_code: "RAFA23",
      plan_name: "Pro",
      plan_amount_cents: 29700,
      owner_email: "maria@padaria.com",
    });

    expect(body.access_url.startsWith("https://crm.exemplo.com/team/accept-invite/")).toBe(true);
    const convite = verifyInviteToken(body.access_url.split("/").at(-1)!);
    expect(convite).toMatchObject({
      email: "maria@padaria.com",
      organization_id: org.id,
      role: "admin",
    });
  });

  it("mesmo request_id não abre segunda empresa", async () => {
    const a = await criarTenant(db.client, pedido(), "https://crm.exemplo.com");
    const b = await criarTenant(db.client, pedido(), "https://crm.exemplo.com");
    expect(b.status).toBe(200);
    expect((b.body as { external_tenant_id: string }).external_tenant_id).toBe(
      (a.body as { external_tenant_id: string }).external_tenant_id,
    );
    expect(db.tabelas.organizations).toHaveLength(1);
  });

  it("suspende e reativa só organização criada pelo Back Office, de forma idempotente", async () => {
    const { external_tenant_id: id } = (
      await criarTenant(db.client, pedido(), "https://crm.exemplo.com")
    ).body as { external_tenant_id: string };

    expect(await alternarSuspensao(db.client, id, true)).toEqual({
      status: 200,
      body: { ok: true, status: "suspended" },
    });
    expect(db.tabelas.organizations[0]).toMatchObject({
      status: "suspended",
      suspended_reason: expect.stringContaining("Back Office"),
    });
    expect(db.tabelas.event_log.map((e) => e.event_type)).toEqual(["tenant.suspended"]);
    expect((await alternarSuspensao(db.client, id, true)).status).toBe(200);

    expect(await alternarSuspensao(db.client, id, false)).toEqual({
      status: 200,
      body: { ok: true, status: "active" },
    });
    expect(db.tabelas.organizations[0]).toMatchObject({ status: "active", suspended_at: null });

    // Organização de fora (signup, painel de plataforma) é invisível para o Back Office.
    db.tabelas.organizations.push({ id: "99999999-9999-4999-8999-999999999999", status: "active" });
    expect(
      (await alternarSuspensao(db.client, "99999999-9999-4999-8999-999999999999", true)).status,
    ).toBe(404);
    expect((await alternarSuspensao(db.client, "nao-e-uuid", true)).status).toBe(404);
  });

  it("altera plano e expõe estatísticas e conciliação", async () => {
    const { external_tenant_id: id } = (
      await criarTenant(db.client, pedido(), "https://crm.exemplo.com")
    ).body as { external_tenant_id: string };
    await criarTenant(
      db.client,
      pedido({ request_id: "0f8fad5b-d9cb-469f-a165-70867728950e", amount_cents: 0 }),
      "https://crm.exemplo.com",
    );

    expect(
      (await alterarPlano(db.client, id, { plan: "Enterprise", amount_cents: 59700 })).status,
    ).toBe(200);
    expect(db.tabelas.backoffice_tenants[0]).toMatchObject({
      plan_name: "Enterprise",
      plan_amount_cents: 59700,
    });

    await alternarSuspensao(db.client, id, true);
    expect((await estatisticas(db.client)).body).toEqual({
      users_total: 2,
      users_active: 1,
      customers_paying: 0,
    });

    const lista = (await assinaturas(db.client, null)).body as {
      items: { customer_external_id: string; status: string }[];
      next_cursor: string | null;
    };
    expect(lista.items.map((i) => i.status).sort()).toEqual(["active", "suspended"]);
    expect(lista.items.find((i) => i.customer_external_id === id)?.status).toBe("suspended");
    expect(lista.next_cursor).toBeNull();
  });
});
