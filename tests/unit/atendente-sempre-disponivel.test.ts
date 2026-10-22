/**
 * ATENDENTE SEMPRE DISPONÍVEL NO HORÁRIO (migration 0246).
 *
 * Medido em produção: a equipe que atende pelo celular nunca ficava elegível,
 * porque o cron `attendant-heartbeat` a desligava 15 minutos depois de fechar o
 * CRM — e todo lead do fluxo de distribuição caía em "ninguém disponível".
 *
 * O que este arquivo prende:
 *   - o cron PULA quem tem `always_available` (o filtro está na consulta, e é
 *     ele que decide — sem ele a opção seria só um rótulo na tela);
 *   - só manager+ liga a opção: o próprio atendente leva 403 sem escrita;
 *   - ligar a opção liga a pessoa agora, salvo pedido explícito de offline.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { availabilityPatchSchema } from "@/lib/schemas/routing";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({
  isServiceRoleConfigured: vi.fn(() => true),
  audit: vi.fn(async () => undefined),
}));
vi.mock("@/lib/env", () => ({ env: { INTERNAL_CRON_SECRET: "segredo-do-cron" } }));

const ORG = "22222222-2222-4222-8222-222222222222";
const EU = "11111111-1111-4111-8111-111111111111";
const OUTRA = "99999999-9999-4999-8999-999999999999";

function sessao(papel: Role) {
  const user: AuthUser = {
    id: EU,
    email: "eu@example.com",
    full_name: "Eu",
    avatar_url: null,
    is_platform_admin: false,
    idioma: "pt-BR" as const,
    organizations: [{ organization_id: ORG, organization_name: "Org", role: papel }],
  };
  vi.mocked(requireRole).mockImplementation(async (min: Role) =>
    ROLE_RANK[papel] >= ROLE_RANK[min]
      ? { ok: true, user, org: { orgId: ORG, name: "Org", role: papel } }
      : { ok: false, response: fail("forbidden_role", `Requer role >= ${min}.`, 403, {}) },
  );
}

/** Dublê do client do usuário: registra o que o upsert recebeu. */
function fazerCliente() {
  const gravado: Array<Record<string, unknown>> = [];
  const from = (tabela: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      maybeSingle: () =>
        Promise.resolve({
          data: tabela === "user_organizations" ? { user_id: OUTRA } : null,
          error: null,
        }),
      upsert: (linha: Record<string, unknown>) => {
        gravado.push(linha);
        return chain;
      },
      single: () => Promise.resolve({ data: gravado.at(-1) ?? null, error: null }),
    };
    return chain;
  };
  return { cliente: { from }, gravado };
}

async function patch(alvo: string, corpo: unknown) {
  const { PATCH } = await import("@/app/api/v1/attendants/availability/[user_id]/route");
  return PATCH(
    new NextRequest(`http://localhost/api/v1/attendants/availability/${alvo}`, {
      method: "PATCH",
      body: JSON.stringify(corpo),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ user_id: alvo }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH always_available — quem pode e o que grava", () => {
  it("o próprio atendente não liga em si mesmo: 403 e nenhuma escrita", async () => {
    sessao("agent");
    const { cliente, gravado } = fazerCliente();
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const res = await patch(EU, { always_available: true });

    expect(res.status).toBe(403);
    expect(gravado).toHaveLength(0);
  });

  it("o atendente segue mudando o próprio status sem tocar na opção", async () => {
    sessao("agent");
    const { cliente, gravado } = fazerCliente();
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const res = await patch(EU, { is_available: true });

    expect(res.status).toBe(200);
    expect(gravado[0]).not.toHaveProperty("always_available");
  });

  it("manager liga a opção e a pessoa fica disponível na hora", async () => {
    sessao("manager");
    const { cliente, gravado } = fazerCliente();
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const res = await patch(OUTRA, { always_available: true });

    expect(res.status).toBe(200);
    expect(gravado[0]).toMatchObject({
      organization_id: ORG,
      user_id: OUTRA,
      always_available: true,
      is_available: true,
    });
    expect(gravado[0]?.last_heartbeat_at).toEqual(expect.any(String));
  });

  it("pedido explícito de offline no mesmo corpo vence: não liga a pessoa", async () => {
    sessao("manager");
    const { cliente, gravado } = fazerCliente();
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    const res = await patch(OUTRA, { always_available: true, is_available: false });

    expect(res.status).toBe(200);
    expect(gravado[0]).toMatchObject({ always_available: true, is_available: false });
    expect(gravado[0]).not.toHaveProperty("last_heartbeat_at");
  });

  it("desligar a opção não derruba a pessoa — quem decide isso é o cron", async () => {
    sessao("manager");
    const { cliente, gravado } = fazerCliente();
    vi.mocked(createClient).mockResolvedValue(cliente as never);

    await patch(OUTRA, { always_available: false });

    expect(gravado[0]).toMatchObject({ always_available: false });
    expect(gravado[0]).not.toHaveProperty("is_available");
  });

  it("o schema aceita a opção sozinha e recusa o que não é booleano", () => {
    expect(availabilityPatchSchema.safeParse({ always_available: true }).success).toBe(true);
    expect(availabilityPatchSchema.safeParse({ always_available: "sim" }).success).toBe(false);
  });
});

describe("cron attendant-heartbeat — pula quem é sempre disponível", () => {
  it("o UPDATE filtra always_available=false junto de is_available=true", async () => {
    const filtros: Array<[string, unknown]> = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      update: () => chain,
      eq: (coluna: string, valor: unknown) => {
        filtros.push([coluna, valor]);
        return chain;
      },
      or: () => chain,
      select: () => Promise.resolve({ data: [], error: null }),
    };
    vi.mocked(createAdminClient).mockReturnValue({ from: () => chain } as never);

    const { GET } = await import("@/app/api/v1/cron/attendant-heartbeat/route");
    const res = await GET(
      new NextRequest("http://localhost/api/v1/cron/attendant-heartbeat", {
        headers: { authorization: "Bearer segredo-do-cron" },
      }),
    );

    expect(res.status).toBe(200);
    expect(filtros).toContainEqual(["is_available", true]);
    expect(filtros).toContainEqual(["always_available", false]);
  });
});
