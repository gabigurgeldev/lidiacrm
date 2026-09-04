/**
 * POST /api/v1/ai/providers/[provider]/sync — o botão que resolve o defeito
 * medido em produção: OpenRouter com chave validada e "Nenhum modelo
 * disponível" porque `ai_models` (catálogo global) tinha ZERO linhas —
 * `select count(*) ... provider='openrouter'` = 0 — e o único jeito de encher
 * era esperar o cron das 04:15, que nunca tinha rodado nesta instalação.
 *
 * Esta rota chama a MESMA função do cron (`sincronizarCatalogo`), puxada por
 * uma pessoa em vez do relógio — não é um caminho paralelo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { ActiveOrg, AuthUser } from "@/lib/auth/types";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));

const sincronizarCatalogo = vi.hoisted(() => vi.fn());
const buscarDaOpenRouter = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/cron/sync-model-catalog/route", () => ({
  sincronizarCatalogo,
  buscarDaOpenRouter,
}));

import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { CatalogoSuspeitoError } from "@/lib/ai/catalogo/sincronizar";

const ORG = "22222222-2222-4222-8222-222222222222";
const ANA = "11111111-1111-4111-8111-111111111111";

const usuario: AuthUser = {
  id: ANA,
  email: "ana@clinica.com.br",
  full_name: "Ana",
  avatar_url: null,
  is_platform_admin: false,
  idioma: "pt-BR" as const,
  organizations: [{ organization_id: ORG, organization_name: "Clínica", role: "manager" }],
};
const orgAtiva: ActiveOrg = { orgId: ORG, name: "Clínica", role: "manager" };

function pedido(): NextRequest {
  return new NextRequest("https://crm.exemplo/api/v1/ai/providers/openrouter/sync", {
    method: "POST",
  });
}

async function chamar(provider: string) {
  const { POST } = await import("@/app/api/v1/ai/providers/[provider]/sync/route");
  return POST(pedido(), { params: Promise.resolve({ provider }) });
}

describe("POST /api/v1/ai/providers/[provider]/sync", () => {
  beforeEach(() => {
    vi.mocked(requireRole).mockReset();
    vi.mocked(audit).mockClear();
    sincronizarCatalogo.mockReset();
    buscarDaOpenRouter.mockReset();
  });

  it("⭐ role abaixo de manager não sincroniza — o gate é o mesmo da tela de Provedores", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: "forbidden" } }, { status: 403 }) as never,
    });

    const res = await chamar("openrouter");

    expect(res.status).toBe(403);
    expect(sincronizarCatalogo).not.toHaveBeenCalled();
  });

  it("⭐ provedor sem catálogo sincronizável (Anthropic) é recusado, não finge sincronizar", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });

    const res = await chamar("anthropic");
    const corpo = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(422);
    expect(corpo.error.code).toBe("invalid_request");
    expect(sincronizarCatalogo).not.toHaveBeenCalled();
  });

  it("provedor desconhecido dá 404", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });

    const res = await chamar("fabricante-que-nao-existe");

    expect(res.status).toBe(404);
  });

  it("⭐ sucesso chama a MESMA função do cron, audita, e devolve o resultado", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    sincronizarCatalogo.mockResolvedValue({
      fonte: "openrouter",
      recebidos: 427,
      gravados: 427,
      depreciados: 0,
      ressuscitados: 0,
    });

    const res = await chamar("openrouter");
    const corpo = (await res.json()) as { data: { gravados: number } };

    expect(res.status).toBe(200);
    expect(corpo.data.gravados).toBe(427);
    expect(sincronizarCatalogo).toHaveBeenCalledWith(expect.anything(), buscarDaOpenRouter);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ai.model_catalog_synced", organizationId: ORG }),
    );
  });

  it("⭐ piso de sanidade recusado vira 200 com o motivo, não 500 — não é erro do operador", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    sincronizarCatalogo.mockRejectedValue(new CatalogoSuspeitoError(3, 400));

    const res = await chamar("openrouter");
    const corpo = (await res.json()) as { data: { recusado: boolean; motivo: string } };

    expect(res.status).toBe(200);
    expect(corpo.data.recusado).toBe(true);
    expect(corpo.data.motivo).toMatch(/piso/u);
  });

  it("origem fora do ar vira 502 upstream_unavailable, não 500 genérico", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    sincronizarCatalogo.mockRejectedValue(new Error("catalogo_origem_status_503"));

    const res = await chamar("openrouter");
    const corpo = (await res.json()) as { error: { code: string } };

    expect(res.status).toBe(502);
    expect(corpo.error.code).toBe("upstream_unavailable");
  });
});
