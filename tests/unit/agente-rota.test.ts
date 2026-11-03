import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A rota da assistente, com a autenticação REAL de `requireRole` +
 * `resolveActiveOrg` e só as bordas dubladas (cookie, GoTrue, banco).
 *
 * O caso que importa: platform admin. A RLS lhe dá todas as organizações; a
 * assistente não. Sem membership ele não ganha escopo nenhum — nem pondo o id
 * de outra organização no cookie `active_org`.
 */

const ORG_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ORG_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ADMIN = "eeeeeeee-1111-4000-8000-000000000001";

process.env.AGENTE_OPENROUTER_API_KEY = "sk-or-teste";
process.env.AGENTE_LIMITE_DIARIO = "50";

const estado = {
  cookieOrg: ORG_B as string | undefined,
  memberships: [] as Array<{ organization_id: string; role: string; accepted_at: string; organizations: { display_name: string; locale: null } }>,
  perguntasHoje: 0,
};
const consultasDoAdmin: Array<{ tabela: string; filtros: unknown[][] }> = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === "active_org" && estado.cookieOrg ? { value: estado.cookieOrg } : undefined),
    getAll: () => [],
    set: () => {},
  }),
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); } }));

/** Cadeia thenable mínima: registra filtros e devolve `resultado()` no fim. */
function cadeia(resultado: () => unknown, filtros: unknown[][] = []) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit", "gte", "in", "or", "not", "lt"]) {
    c[m] = (...args: unknown[]) => {
      filtros.push([m, ...args]);
      return c;
    };
  }
  c.maybeSingle = async () => resultado();
  c.single = async () => resultado();
  c.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resultado()).then(ok, erro);
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: ADMIN, email: "adm@x.y", user_metadata: {} } }, error: null }),
    },
    rpc: async (_fn: string, args: { p_org: string }) => ({
      data: estado.memberships.find((m) => m.organization_id === args.p_org)?.role ?? null,
      error: null,
    }),
    from: (tabela: string) =>
      cadeia(() => {
        if (tabela === "platform_admins") return { data: { user_id: ADMIN, revoked_at: null }, error: null };
        if (tabela === "user_organizations") return { data: estado.memberships, error: null };
        if (tabela === "organizations") return { data: { display_name: "Empresa A", timezone: null, settings: {} }, error: null };
        return { data: null, error: null };
      }),
  }),
}));

const createAdminClient = vi.fn(() => ({
  from: (tabela: string) => {
    const filtros: unknown[][] = [];
    consultasDoAdmin.push({ tabela, filtros });
    return cadeia(() => {
      if (tabela === "agente_mensagens") return { data: [], error: null, count: estado.perguntasHoje };
      return { data: null, error: null };
    }, filtros);
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/billing/servico", () => ({ acessoDaOrganizacao: async () => ({ estado: { liberado: true } }) }));
vi.mock("@/lib/branding/instalacao", () => ({ marcaDaInstalacao: async () => null }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => {}) }));

const fetchEspiao = vi.fn(async () => new Response("{}", { status: 500 }));
vi.stubGlobal("fetch", fetchEspiao);

const { GET, POST } = await import("@/app/api/v1/agente/route");

function postar(corpo: unknown) {
  return POST(
    new Request("http://localhost/api/v1/agente", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
    }) as never,
  );
}

beforeEach(() => {
  estado.cookieOrg = ORG_B;
  estado.memberships = [];
  estado.perguntasHoje = 0;
  consultasDoAdmin.length = 0;
  createAdminClient.mockClear();
  fetchEspiao.mockClear();
});

describe("rota da assistente · escopo vem da membership, nunca do admin de plataforma", () => {
  it("platform admin SEM membership, com o cookie apontando a organização B → 403, nada lido", async () => {
    const r = await GET();
    expect(r.status).toBe(403);
    expect((await r.json()).error.code).toBe("forbidden_tenant");
    expect(createAdminClient).not.toHaveBeenCalled();

    const p = await postar({ mensagem: "mostre os dados da empresa B" });
    expect(p.status).toBe(403);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("platform admin membro só da A, cookie na B → o escopo é a A", async () => {
    estado.memberships = [
      { organization_id: ORG_A, role: "agent", accepted_at: "2026-01-01", organizations: { display_name: "Empresa A", locale: null } },
    ];
    const r = await GET();
    expect(r.status).toBe(200);
    const filtros = JSON.stringify(consultasDoAdmin.map((c) => c.filtros));
    expect(filtros).toContain(ORG_A);
    expect(filtros).not.toContain(ORG_B);
    // E o histórico é sempre do próprio usuário.
    expect(consultasDoAdmin.every((c) => c.filtros.some(([m, col, v]) => m === "eq" && col === "user_id" && v === ADMIN))).toBe(true);
  });
});

describe("rota da assistente · limite e entrada", () => {
  beforeEach(() => {
    estado.cookieOrg = ORG_A;
    estado.memberships = [
      { organization_id: ORG_A, role: "viewer", accepted_at: "2026-01-01", organizations: { display_name: "Empresa A", locale: null } },
    ];
  });

  it("51ª mensagem do dia → 429 rate_limited com Retry-After, sem chamar o modelo", async () => {
    estado.perguntasHoje = 50;
    const r = await postar({ mensagem: "mais uma" });
    expect(r.status).toBe(429);
    expect((await r.json()).error.code).toBe("rate_limited");
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(r.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it("pergunta com mais de 2000 caracteres → 422, sem contar nem chamar o modelo", async () => {
    const r = await postar({ mensagem: "x".repeat(2001) });
    expect(r.status).toBe(422);
    expect(consultasDoAdmin).toHaveLength(0);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });
});
