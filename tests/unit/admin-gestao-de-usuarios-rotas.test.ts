import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/**
 * Rotas de gestão de usuários do painel da plataforma.
 *
 * O que se prova aqui, e por quê:
 *  - GATE: toda rota nova devolve 403 para quem não é platform admin. O painel
 *    age sobre QUALQUER organização; uma rota esquecida sem gate é acesso
 *    cross-tenant para qualquer conta logada.
 *  - TRAVAS: suspender/excluir a si mesmo, o último platform admin, e remover
 *    ou rebaixar o último admin de uma organização são recusados com 409 — e,
 *    recusados, NÃO chegam a escrever no Auth nem no banco.
 *  - AUDIT: ação que aconteceu emite o código `platform_admin.*` certo.
 */

vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const ATOR = "11111111-1111-4111-8111-111111111111";
const ALVO = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

interface Estado {
  platformAdmins: string[];
  alvo: {
    id: string;
    email: string;
    banned_until?: string | null;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
  } | null;
  vinculo: { id: string; role: string; revoked_at: string | null } | null;
  adminsNaOrg: number;
  vinculosAdminDoAlvo: Array<{ organization_id: string; organizations: { display_name: string } }>;
}

let estado: Estado;
const updateUserById = vi.fn(async () => ({ data: {}, error: null }));
const deleteUser = vi.fn(async () => ({ data: {}, error: null }));
const updates: Array<{ tabela: string; valores: unknown }> = [];

/** Builder encadeável que resolve conforme a tabela e o formato da consulta. */
function builder(tabela: string) {
  const ctx: { head?: boolean; select?: string; eqs: Record<string, unknown>; update?: unknown } = {
    eqs: {},
  };
  const b: Record<string, unknown> = {};
  const self = () => b;
  b.select = (cols: string, opts?: { head?: boolean }) => {
    ctx.select = cols;
    ctx.head = opts?.head;
    return b;
  };
  b.eq = (col: string, val: unknown) => {
    ctx.eqs[col] = val;
    return b;
  };
  b.is = self;
  b.order = self;
  b.range = self;
  b.update = (valores: unknown) => {
    ctx.update = valores;
    updates.push({ tabela, valores });
    return b;
  };
  b.maybeSingle = async () => {
    if (tabela === "user_organizations") return { data: estado.vinculo, error: null };
    return { data: null, error: null };
  };
  b.then = (res: (v: unknown) => unknown) => {
    if (ctx.update !== undefined) return Promise.resolve({ error: null }).then(res);
    if (tabela === "platform_admins") {
      return Promise.resolve({
        data: estado.platformAdmins.map((user_id) => ({ user_id })),
        error: null,
      }).then(res);
    }
    if (tabela === "user_organizations" && ctx.head) {
      return Promise.resolve({ count: estado.adminsNaOrg, error: null }).then(res);
    }
    if (tabela === "user_organizations") {
      return Promise.resolve({ data: estado.vinculosAdminDoAlvo, error: null }).then(res);
    }
    return Promise.resolve({ data: [], error: null }).then(res);
  };
  return b;
}

function adminStub() {
  return {
    from: (t: string) => builder(t),
    auth: {
      admin: {
        getUserById: vi.fn(async () =>
          estado.alvo
            ? { data: { user: estado.alvo }, error: null }
            : { data: { user: null }, error: { message: "not found" } },
        ),
        updateUserById,
        deleteUser,
        listUsers: vi.fn(async () => ({ data: { users: [] }, error: null })),
      },
    },
  };
}

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } }
      : {}),
  });
}

const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  estado = {
    platformAdmins: [ATOR],
    alvo: {
      id: ALVO,
      email: "alvo@exemplo.com",
      banned_until: null,
      email_confirmed_at: "2026-01-01T00:00:00Z",
      last_sign_in_at: "2026-09-01T00:00:00Z",
      app_metadata: { provider: "email" },
      user_metadata: { locale: "pt-BR" },
    },
    vinculo: { id: "v1", role: "agent", revoked_at: null },
    adminsNaOrg: 2,
    vinculosAdminDoAlvo: [],
  };
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    user: { id: ATOR } as never,
    platformAdmin: { user_id: ATOR, scope: "all", mfa_required: false },
  });
  vi.mocked(createAdminClient).mockReturnValue(adminStub() as never);
});

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

describe("gate de platform admin", () => {
  it("toda rota nova devolve 403 quando requirePlatformAdmin barra", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("NEXT_REDIRECT"));

    const detalhe = await import("@/app/api/v1/admin/users/[id]/route");
    const suspender = await import("@/app/api/v1/admin/users/[id]/suspend/route");
    const reativar = await import("@/app/api/v1/admin/users/[id]/reactivate/route");
    const vinculo = await import("@/app/api/v1/admin/users/[id]/memberships/[orgId]/route");
    const relatorio = await import("@/app/api/v1/admin/users/report/route");
    const exportar = await import("@/app/api/v1/admin/users/export/route");

    const respostas = await Promise.all([
      detalhe.PATCH(req(`/api/v1/admin/users/${ALVO}`, "PATCH", { full_name: "x" }), params({ id: ALVO })),
      detalhe.DELETE(req(`/api/v1/admin/users/${ALVO}`, "DELETE", { confirm_email: "alvo@exemplo.com" }), params({ id: ALVO })),
      suspender.POST(req("/x", "POST", { reason: "motivo suficiente" }), params({ id: ALVO })),
      reativar.POST(req("/x", "POST", {}), params({ id: ALVO })),
      vinculo.PATCH(req("/x", "PATCH", { role: "viewer" }), params({ id: ALVO, orgId: ORG })),
      vinculo.DELETE(req("/x", "DELETE"), params({ id: ALVO, orgId: ORG })),
      relatorio.GET(req("/api/v1/admin/users/report", "GET")),
      exportar.GET(req("/api/v1/admin/users/export", "GET")),
    ]);

    expect(respostas.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
    expect(updateUserById).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Suspender / reativar
// ---------------------------------------------------------------------------

describe("POST /users/[id]/suspend", () => {
  it("suspende, grava o motivo em app_metadata sem apagar o resto, e audita", async () => {
    const { POST } = await import("@/app/api/v1/admin/users/[id]/suspend/route");
    const res = await POST(req("/x", "POST", { reason: "abuso reportado pelo cliente" }), params({ id: ALVO }));
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(
      ALVO,
      expect.objectContaining({
        ban_duration: "876000h",
        app_metadata: expect.objectContaining({
          provider: "email",
          suspensao: expect.objectContaining({ motivo: "abuso reportado pelo cliente", por: ATOR }),
        }),
      }),
    );
    expect(vi.mocked(audit).mock.calls[0]?.[0].action).toBe("platform_admin.user_suspended");
  });

  it("recusa a própria conta com 409 e não escreve", async () => {
    estado.alvo!.id = ATOR;
    const { POST } = await import("@/app/api/v1/admin/users/[id]/suspend/route");
    const res = await POST(req("/x", "POST", { reason: "motivo suficiente" }), params({ id: ATOR }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.motivo).toBe("propria_conta");
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("recusa o último platform admin", async () => {
    estado.platformAdmins = [ALVO];
    const { POST } = await import("@/app/api/v1/admin/users/[id]/suspend/route");
    const res = await POST(req("/x", "POST", { reason: "motivo suficiente" }), params({ id: ALVO }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.details.motivo).toBe("ultimo_admin");
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("motivo curto é 4xx de validação", async () => {
    const { POST } = await import("@/app/api/v1/admin/users/[id]/suspend/route");
    const res = await POST(req("/x", "POST", { reason: "curto" }), params({ id: ALVO }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it("reativar conta que não está suspensa é 409", async () => {
    const { POST } = await import("@/app/api/v1/admin/users/[id]/reactivate/route");
    const res = await POST(req("/x", "POST", {}), params({ id: ALVO }));
    expect(res.status).toBe(409);
  });

  it("reativar tira o ban e limpa a suspensão", async () => {
    estado.alvo!.banned_until = "2126-01-01T00:00:00Z";
    const { POST } = await import("@/app/api/v1/admin/users/[id]/reactivate/route");
    const res = await POST(req("/x", "POST", {}), params({ id: ALVO }));
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(
      ALVO,
      expect.objectContaining({ ban_duration: "none", app_metadata: expect.objectContaining({ suspensao: null }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// Editar / excluir
// ---------------------------------------------------------------------------

describe("PATCH/DELETE /users/[id]", () => {
  it("editar o nome preserva o resto do user_metadata", async () => {
    const { PATCH } = await import("@/app/api/v1/admin/users/[id]/route");
    const res = await PATCH(req("/x", "PATCH", { full_name: "Nome Novo" }), params({ id: ALVO }));
    expect(res.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledWith(ALVO, {
      user_metadata: { locale: "pt-BR", full_name: "Nome Novo" },
    });
  });

  it("excluir com e-mail que não confere é 422 e não apaga", async () => {
    const { DELETE } = await import("@/app/api/v1/admin/users/[id]/route");
    const res = await DELETE(req("/x", "DELETE", { confirm_email: "outro@exemplo.com" }), params({ id: ALVO }));
    expect(res.status).toBe(422);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("excluir o único admin de uma organização é 409 e não apaga", async () => {
    estado.vinculosAdminDoAlvo = [{ organization_id: ORG, organizations: { display_name: "Alfa" } }];
    estado.adminsNaOrg = 1;
    const { DELETE } = await import("@/app/api/v1/admin/users/[id]/route");
    const res = await DELETE(req("/x", "DELETE", { confirm_email: "alvo@exemplo.com" }), params({ id: ALVO }));
    expect(res.status).toBe(409);
    expect(deleteUser).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("excluir é SOFT delete, revoga vínculos antes e audita", async () => {
    const { DELETE } = await import("@/app/api/v1/admin/users/[id]/route");
    const res = await DELETE(req("/x", "DELETE", { confirm_email: "ALVO@exemplo.com" }), params({ id: ALVO }));
    expect(res.status).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(ALVO, true);
    expect(updates[0]?.tabela).toBe("user_organizations");
    expect(vi.mocked(audit).mock.calls.at(-1)?.[0].action).toBe("platform_admin.user_deleted");
  });
});

// ---------------------------------------------------------------------------
// Vínculo
// ---------------------------------------------------------------------------

describe("/users/[id]/memberships/[orgId]", () => {
  it("rebaixar o último admin da organização é 409", async () => {
    estado.vinculo = { id: "v1", role: "admin", revoked_at: null };
    estado.adminsNaOrg = 1;
    const { PATCH } = await import("@/app/api/v1/admin/users/[id]/memberships/[orgId]/route");
    const res = await PATCH(req("/x", "PATCH", { role: "agent" }), params({ id: ALVO, orgId: ORG }));
    expect(res.status).toBe(409);
    expect(updates).toHaveLength(0);
  });

  it("remover da organização revoga o vínculo e audita", async () => {
    const { DELETE } = await import("@/app/api/v1/admin/users/[id]/memberships/[orgId]/route");
    const res = await DELETE(req("/x", "DELETE"), params({ id: ALVO, orgId: ORG }));
    expect(res.status).toBe(200);
    expect(updates[0]).toMatchObject({ tabela: "user_organizations", valores: { revoked_at: expect.any(String) } });
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      action: "platform_admin.user_removed_from_org",
      organizationId: ORG,
    });
  });

  it("trocar papel audita de/para", async () => {
    const { PATCH } = await import("@/app/api/v1/admin/users/[id]/memberships/[orgId]/route");
    const res = await PATCH(req("/x", "PATCH", { role: "manager" }), params({ id: ALVO, orgId: ORG }));
    expect(res.status).toBe(200);
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      action: "platform_admin.user_role_changed",
      metadata: { de: "agent", para: "manager" },
    });
  });
});
