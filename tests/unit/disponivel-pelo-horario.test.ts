/**
 * ATENDENTE DISPONÍVEL PELO HORÁRIO, E O ONLINE QUE NÃO CAI EM 15 MINUTOS.
 *
 * Medido em produção (2026-10-16): quem ligava "Disponível" voltava a offline
 * em até 20 min — o cron derrubava por heartbeat velho, e nenhuma tela pingava.
 * Com o rodízio ligado, ninguém nunca era elegível.
 *
 * Este arquivo prende as três peças do conserto:
 *  1. a varredura do cron poupa quem tem `follows_schedule`;
 *  2. `POST /api/v1/attendants/heartbeat` só renova quem JÁ está online, do
 *     próprio usuário, na org do cookie — e não audita a cada minuto;
 *  3. o hook existe, está montado na casca do app e pinga bem dentro do corte.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { ROLE_RANK, type AuthUser, type Role } from "@/lib/auth/types";
import { HEARTBEAT_TIMEOUT_MINUTES } from "@/lib/routing/eligibility";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/env", () => ({ env: { INTERNAL_CRON_SECRET: "segredo", INTERNAL_SECRET: "" } }));

const ORG = "22222222-2222-4222-8222-222222222222";
const ANA = "11111111-1111-4111-8111-111111111111";

/** Dublê que REGISTRA cada filtro aplicado — é o filtro que está sob teste. */
function clienteQueGrava(resposta: unknown[]) {
  const chamadas: Array<[string, ...unknown[]]> = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["from", "update", "eq", "or", "select"]) {
    chain[m] = (...args: unknown[]) => {
      chamadas.push([m, ...args]);
      return chain;
    };
  }
  chain.then = (res: (v: unknown) => unknown) =>
    Promise.resolve({ data: resposta, error: null }).then(res);
  return { cliente: chain, chamadas };
}

function sessao(papel: Role) {
  const user: AuthUser = {
    id: ANA,
    email: "ana@example.com",
    full_name: "Ana",
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

beforeEach(() => {
  vi.mocked(audit).mockClear();
});

describe("cron attendant-heartbeat", () => {
  it("só derruba quem NÃO segue o horário", async () => {
    const { cliente, chamadas } = clienteQueGrava([]);
    vi.mocked(createAdminClient).mockReturnValue(
      cliente as unknown as ReturnType<typeof createAdminClient>,
    );
    const { GET } = await import("@/app/api/v1/cron/attendant-heartbeat/route");
    const res = await GET(
      new NextRequest("http://localhost/api/v1/cron/attendant-heartbeat", {
        headers: { authorization: "Bearer segredo" },
      }),
    );
    expect(res.status).toBe(200);
    expect(chamadas).toContainEqual(["eq", "follows_schedule", false]);
    expect(chamadas).toContainEqual(["eq", "is_available", true]);
  });
});

describe("POST /api/v1/attendants/heartbeat", () => {
  async function chamar() {
    const { POST } = await import("@/app/api/v1/attendants/heartbeat/route");
    return POST(new NextRequest("http://localhost/api/v1/attendants/heartbeat", { method: "POST" }));
  }

  it("renova só a linha do próprio usuário, na org do cookie, e só se já está online", async () => {
    sessao("agent");
    const { cliente, chamadas } = clienteQueGrava([{ user_id: ANA }]);
    vi.mocked(createClient).mockResolvedValue(
      cliente as unknown as Awaited<ReturnType<typeof createClient>>,
    );

    const res = await chamar();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { online: boolean } }).data.online).toBe(true);

    expect(chamadas).toContainEqual(["eq", "organization_id", ORG]);
    expect(chamadas).toContainEqual(["eq", "user_id", ANA]);
    // Nunca LIGA ninguém: quem se pôs offline não volta por ter a aba aberta.
    expect(chamadas).toContainEqual(["eq", "is_available", true]);
    const update = chamadas.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(["last_heartbeat_at"]);
  });

  it("offline responde online=false sem erro", async () => {
    sessao("agent");
    const { cliente } = clienteQueGrava([]);
    vi.mocked(createClient).mockResolvedValue(
      cliente as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    const res = await chamar();
    expect(((await res.json()) as { data: { online: boolean } }).data.online).toBe(false);
  });

  it("não audita: um ping por minuto afogaria o audit log", async () => {
    sessao("agent");
    const { cliente } = clienteQueGrava([{ user_id: ANA }]);
    vi.mocked(createClient).mockResolvedValue(
      cliente as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await chamar();
    expect(audit).not.toHaveBeenCalled();
  });

  it("viewer não é atendente e é barrado", async () => {
    sessao("viewer");
    expect((await chamar()).status).toBe(403);
  });
});

describe("useHeartbeat", () => {
  const raiz = process.cwd();

  it("está montado na casca do app — vale em qualquer página", () => {
    const casca = readFileSync(join(raiz, "app/app/_components/AppShell.tsx"), "utf8");
    expect(casca).toMatch(/^\s*useHeartbeat\(\);/m);
  });

  it("pinga a rota de heartbeat, e com folga de 3× contra o corte", async () => {
    const fonte = readFileSync(join(raiz, "hooks/team/useHeartbeat.ts"), "utf8");
    expect(fonte).toContain('"/api/v1/attendants/heartbeat"');
    const { INTERVALO_DO_HEARTBEAT_MS } = await import("@/hooks/team/useHeartbeat");
    expect(INTERVALO_DO_HEARTBEAT_MS * 3).toBeLessThanOrEqual(HEARTBEAT_TIMEOUT_MINUTES * 60_000);
  });
});
