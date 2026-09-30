/**
 * POST /api/v1/ai/providers/[provider]/models — usar um modelo da OpenRouter
 * pelo CÓDIGO, sem esperar o cron diário trazê-lo.
 *
 * O que precisa estar certo: o código é CONFERIDO na origem antes de entrar no
 * catálogo (erro de digitação vira 404 agora, não um agente mudo depois), a
 * linha entra com o preço de verdade, e só a OpenRouter aceita — os demais
 * provedores não têm origem para conferir.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import type { ActiveOrg, AuthUser } from "@/lib/auth/types";
import type { ModeloDaOpenRouter } from "@/lib/ai/catalogo/openrouter";

vi.mock("@/lib/auth/require-role", () => ({ requireRole: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn(), resolveActiveOrg: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const upsert = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn(() => ({ upsert })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({ from })) }));

const buscarDaOpenRouter = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/v1/cron/sync-model-catalog/route", () => ({ buscarDaOpenRouter }));

import { requireRole } from "@/lib/auth/require-role";
import { audit } from "@/lib/audit";
import { esquecerCatalogoDaOrigem } from "@/lib/ai/catalogo/origem-em-cache";

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

const NOVO: ModeloDaOpenRouter = {
  id: "moonshotai/kimi-k3",
  name: "MoonshotAI: Kimi K3",
  context_length: 256000,
  pricing: { prompt: "0.0000006", completion: "0.0000025" },
  supported_parameters: ["tools", "temperature"],
};

async function chamar(provider: string, corpo: unknown) {
  const { POST } = await import("@/app/api/v1/ai/providers/[provider]/models/route");
  const req = new NextRequest(`https://crm.exemplo/api/v1/ai/providers/${provider}/models`, {
    method: "POST",
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
    headers: { "content-type": "application/json" },
  });
  return POST(req, { params: Promise.resolve({ provider }) });
}

describe("POST /api/v1/ai/providers/[provider]/models", () => {
  beforeEach(() => {
    esquecerCatalogoDaOrigem();
    vi.mocked(requireRole).mockReset();
    vi.mocked(audit).mockClear();
    upsert.mockReset().mockResolvedValue({ error: null });
    from.mockClear();
    buscarDaOpenRouter.mockReset();
  });

  it("⭐ abaixo de manager não mexe no catálogo", async () => {
    vi.mocked(requireRole).mockResolvedValue({
      ok: false,
      response: Response.json({ error: { code: "forbidden" } }, { status: 403 }) as never,
    });
    const res = await chamar("openrouter", { model_id: NOVO.id });
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("⭐ Anthropic não aceita código — não há origem para conferir", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    const res = await chamar("anthropic", { model_id: "claude-qualquer" });
    expect(res.status).toBe(422);
    expect(buscarDaOpenRouter).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("body sem código é 422", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    const res = await chamar("openrouter", { model_id: "   " });
    expect(res.status).toBe(422);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("body que não é JSON é 400", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    const res = await chamar("openrouter", "isto não é json");
    expect(res.status).toBe(400);
  });

  it("⭐ código que não existe na origem é 404 e NÃO grava nada", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    buscarDaOpenRouter.mockResolvedValue([NOVO]);
    const res = await chamar("openrouter", { model_id: "moonshotai/kimi-k3-typo" });
    const corpo = (await res.json()) as { error: { code: string; message: string } };
    expect(res.status).toBe(404);
    expect(corpo.error.message).toContain("moonshotai/kimi-k3-typo");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("⭐ modelo lançado depois da memória: vai à origem de novo antes de dizer 404", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    buscarDaOpenRouter.mockResolvedValueOnce([]).mockResolvedValueOnce([NOVO]);
    const res = await chamar("openrouter", { model_id: NOVO.id });
    expect(res.status).toBe(200);
    expect(buscarDaOpenRouter).toHaveBeenCalledTimes(2);
  });

  it("⭐ código válido entra no catálogo com preço e ferramentas da origem, e audita", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    buscarDaOpenRouter.mockResolvedValue([NOVO]);

    const res = await chamar("openrouter", { model_id: `  ${NOVO.id}  ` });
    const corpo = (await res.json()) as { data: { model: { model_id: string; context_window: number } } };

    expect(res.status).toBe(200);
    expect(corpo.data.model.model_id).toBe(NOVO.id);
    expect(corpo.data.model.context_window).toBe(256000);
    expect(from).toHaveBeenCalledWith("ai_models");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        model_id: NOVO.id,
        source: "openrouter",
        input_price_per_million_cents: 60,
        output_price_per_million_cents: 250,
        supports_tools: true,
        deprecated_at: null,
      }),
      { onConflict: "provider,model_id" },
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ai.model_catalog_added",
        organizationId: ORG,
        resourceId: null,
        metadata: { provedor: "openrouter", model_id: NOVO.id },
      }),
    );
  });

  it("origem fora do ar é 502, não 500", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    buscarDaOpenRouter.mockRejectedValue(new Error("catalogo_origem_status_503"));
    const res = await chamar("openrouter", { model_id: NOVO.id });
    const corpo = (await res.json()) as { error: { code: string } };
    expect(res.status).toBe(502);
    expect(corpo.error.code).toBe("upstream_unavailable");
    expect(upsert).not.toHaveBeenCalled();
  });

  it("falha ao gravar é 500 e não audita", async () => {
    vi.mocked(requireRole).mockResolvedValue({ ok: true, user: usuario, org: orgAtiva });
    buscarDaOpenRouter.mockResolvedValue([NOVO]);
    upsert.mockResolvedValue({ error: { message: "boom" } });
    const res = await chamar("openrouter", { model_id: NOVO.id });
    expect(res.status).toBe(500);
    expect(audit).not.toHaveBeenCalled();
  });
});
