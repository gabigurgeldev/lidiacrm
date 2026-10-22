/**
 * QUEM SAI DA EQUIPE SAI DA AGENDA — `POST /api/v1/team/[user_id]/revoke`.
 *
 * Revogar gravava `user_organizations.revoked_at` e deixava
 * `calendar_professionals.is_active = true`: a IA seguia oferecendo horário de
 * quem não estava mais na empresa. Aqui se prova, contra o Route Handler REAL:
 *
 *   1. a revogação desativa a profissional do membro, filtrando a organização
 *      ATIVA de quem revoga (nunca outra);
 *   2. falha ao desativar NÃO desfaz a revogação nem vira 500 — o acesso já
 *      foi tirado, e o filtro de consumo (`membrosRevogados`) segura a oferta;
 *   3. revogação recusada (último admin) não mexe na agenda.
 *
 * O filtro de consumo tem prova própria em `agenda-coleta-dos-profissionais`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const { requireRole } = await import("@/lib/auth/require-role");
const { createClient } = await import("@/lib/supabase/server");
const { audit } = await import("@/lib/audit");
const { POST } = await import("@/app/api/v1/team/[user_id]/revoke/route");

const ATOR = "11111111-1111-4111-8111-111111111111";
const ALVO = "33333333-3333-4333-8333-333333333333";
const ORG = "22222222-2222-4222-8222-222222222222";

interface Chamada {
  tabela: string;
  update?: Record<string, unknown>;
  eqs: Record<string, unknown>;
  ins: Record<string, unknown[]>;
}

let chamadas: Chamada[];
let alvo: { id: string; user_id: string; role: string; revoked_at: string | null } | null;
let adminsAtivos: number;
let falharAgenda: boolean;

/** Stub encadeável: registra cada consulta e responde pela tabela. */
function stub() {
  return {
    from(tabela: string) {
      const c: Chamada = { tabela, eqs: {}, ins: {} };
      chamadas.push(c);
      let head = false;
      const b: Record<string, unknown> = {};
      b.select = (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      };
      b.update = (valores: Record<string, unknown>) => {
        c.update = valores;
        return b;
      };
      b.eq = (col: string, v: unknown) => {
        c.eqs[col] = v;
        return b;
      };
      b.in = (col: string, vs: unknown[]) => {
        c.ins[col] = vs;
        return b;
      };
      b.is = () => b;
      b.maybeSingle = async () => ({ data: alvo, error: null });
      b.then = (ok: (v: unknown) => unknown) => {
        if (tabela === "calendar_professionals" && falharAgenda) {
          return Promise.resolve({ data: null, error: { message: "rls" } }).then(ok);
        }
        if (tabela === "calendar_professionals") {
          return Promise.resolve({ data: [{ id: "p-1" }], error: null }).then(ok);
        }
        if (head) return Promise.resolve({ count: adminsAtivos, error: null }).then(ok);
        return Promise.resolve({ data: null, error: null }).then(ok);
      };
      return b;
    },
  };
}

function revogar() {
  return POST(new NextRequest("http://localhost/x", { method: "POST" }), {
    params: Promise.resolve({ user_id: ALVO }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  chamadas = [];
  alvo = { id: "m-1", user_id: ALVO, role: "agent", revoked_at: null };
  adminsAtivos = 2;
  falharAgenda = false;
  vi.mocked(requireRole).mockResolvedValue({
    ok: true,
    user: { id: ATOR },
    org: { orgId: ORG },
  } as never);
  vi.mocked(createClient).mockResolvedValue(stub() as never);
});

describe("revogar membro tira a profissional dele da agenda", () => {
  it("desativa a profissional do membro, só na organização ativa", async () => {
    const res = await revogar();
    expect(res.status).toBe(200);

    const agenda = chamadas.find((c) => c.tabela === "calendar_professionals");
    expect(agenda?.update).toEqual({ is_active: false });
    expect(agenda?.eqs).toMatchObject({ user_id: ALVO, is_active: true });
    expect(agenda?.ins.organization_id).toEqual([ORG]);

    // Depois da revogação, nunca antes: desativar quem NÃO foi revogado
    // (revogação que falhou) tiraria da agenda alguém que segue na equipe.
    const ordem = chamadas.filter((c) => c.update).map((c) => c.tabela);
    expect(ordem).toEqual(["user_organizations", "calendar_professionals"]);

    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      action: "member.revoked",
      metadata: { profissionais_desativadas: 1 },
    });
  });

  it("falha ao desativar NÃO vira 500 — a revogação já aconteceu", async () => {
    falharAgenda = true;
    const res = await revogar();
    expect(res.status).toBe(200);
    expect(vi.mocked(audit).mock.calls[0]?.[0]).toMatchObject({
      metadata: { profissionais_desativadas: null },
    });
  });

  it("revogação recusada (último admin) não mexe na agenda", async () => {
    alvo = { id: "m-1", user_id: ALVO, role: "admin", revoked_at: null };
    adminsAtivos = 1;
    const res = await revogar();
    expect(res.status).toBe(409);
    expect(chamadas.some((c) => c.tabela === "calendar_professionals")).toBe(false);
  });

  it("já revogado: idempotente, sem nova escrita", async () => {
    alvo = { id: "m-1", user_id: ALVO, role: "agent", revoked_at: "2026-10-01T00:00:00Z" };
    const res = await revogar();
    expect(res.status).toBe(200);
    expect(chamadas.some((c) => c.update)).toBe(false);
  });
});
