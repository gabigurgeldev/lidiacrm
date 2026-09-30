/**
 * GET  /api/v1/ai/providers/:provider/models — lista o catálogo.
 * POST /api/v1/ai/providers/:provider/models — traz UM modelo da origem.
 *
 * GET lê do catálogo curado `ai_models` (tabela GLOBAL, RLS read-all).
 * Retorna modelos não-deprecated ordenados por default-first depois preço.
 *
 * ═══ Por que o POST existe ═══
 *
 * O catálogo da OpenRouter só mudava pelo cron diário: modelo lançado hoje não
 * podia ser escolhido até amanhã — e digitar o código no agente não bastava,
 * porque a publicação (`fn_publish_ai_agent_version`, baseline.sql) recusa com
 * `model_not_found` todo modelo que não está em `ai_models`. Então "usar pelo
 * código" tem de passar por aqui: o código é CONFERIDO na origem (erro de
 * digitação vira 404 agora, não um agente que falha calado na primeira
 * mensagem) e a linha entra no catálogo com o preço de verdade — o número de
 * que o teto de orçamento depende.
 *
 * A linha entra com `source = 'openrouter'`, a mesma do cron: dali em diante
 * ele a mantém como qualquer outra (preço atualizado, depreciada se sumir). Não
 * nasce um terceiro dono do catálogo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehProvedorSuportado, PROVEDORES } from "@/lib/ai/pontos/provedores";
import { traduzirCatalogo } from "@/lib/ai/catalogo/openrouter";
import { catalogoDaOrigem } from "@/lib/ai/catalogo/origem-em-cache";
import { buscarDaOpenRouter } from "@/app/api/v1/cron/sync-model-catalog/route";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// A lista única (`lib/ai/pontos/provedores.ts`) — não uma quarta cópia. Esta
// rota alimenta o seletor de modelos; com a lista velha, pedir os modelos da
// OpenRouter devolvia "provedor desconhecido" para um provedor que a tela ao
// lado oferecia.

const MODEL_COLUMNS =
  "id, provider, model_id, display_name, description, context_window, input_price_per_million_cents, output_price_per_million_cents, supports_tools, is_default_for_provider, deprecated_at, released_at";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { provider } = await ctx.params;

  if (!ehProvedorSuportado(provider)) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }

  const authUser = await loadAuthUser();
  if (!authUser) return fail("unauthenticated", "Auth required.", 401, { requestId });
  const activeOrg = await resolveActiveOrg(authUser);
  if (!activeOrg) {
    return fail("forbidden_tenant", "Sem organização ativa.", 403, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_models")
    .select(MODEL_COLUMNS)
    .eq("provider", provider)
    .is("deprecated_at", null)
    .order("is_default_for_provider", { ascending: false })
    .order("input_price_per_million_cents", { ascending: true });

  if (error) {
    return fail("internal_error", "Erro ao listar modelos.", 500, { requestId });
  }

  return ok({ models: data ?? [] }, { requestId });
}

const adicionarSchema = z.object({
  model_id: z.string().trim().min(1).max(200),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  // Mesmo gate do "Sincronizar catálogo": o catálogo é da instalação inteira,
  // e quem mexe nele é quem já podia sincronizá-lo.
  const authz = await requireRole("manager", { requestId, resource: "ai_providers" });
  if (!authz.ok) return authz.response;

  const { provider } = await ctx.params;
  if (!ehProvedorSuportado(provider)) {
    return fail("not_found", "Provider desconhecido.", 404, { requestId });
  }
  // Só a OpenRouter tem origem para conferir. Para Anthropic/OpenAI/Google,
  // aceitar um código sem conferir gravaria no catálogo um modelo sem preço e
  // sem saber se chama ferramenta — exatamente o que a conferência existe para
  // impedir.
  if (!PROVEDORES.find((p) => p.id === provider)?.catalogoSincronizavel || provider !== "openrouter") {
    return fail(
      "invalid_request",
      "este provedor não aceita modelo por código — os modelos dele já vêm prontos na instalação",
      422,
      { requestId },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = adicionarSchema.safeParse(rawBody);
  if (!parsed.success) {
    return fail("validation_failed", "Informe o código do modelo.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const modelId = parsed.data.model_id;

  let linha;
  try {
    const acharNa = (modelos: Awaited<ReturnType<typeof buscarDaOpenRouter>>) =>
      traduzirCatalogo(modelos).find((l) => l.model_id === modelId);
    // Primeiro a memória; se o código não está lá, a origem de novo — o
    // modelo pode ter sido lançado depois que a memória foi preenchida, e é
    // justamente o modelo recém-lançado que trouxe a pessoa até aqui.
    linha =
      acharNa(await catalogoDaOrigem(buscarDaOpenRouter)) ??
      acharNa(await catalogoDaOrigem(buscarDaOpenRouter, { fresco: true }));
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[ai.providers.models.add] origem falhou", { error: detalhe, request_id: requestId });
    return fail(
      "upstream_unavailable",
      "Não conseguimos falar com a OpenRouter agora. Tente de novo em instantes.",
      502,
      { requestId },
    );
  }

  if (!linha) {
    return fail(
      "not_found",
      `O código "${modelId}" não existe na OpenRouter. Confira como ele está escrito lá — por exemplo, anthropic/claude-sonnet-4.5.`,
      404,
      { requestId },
    );
  }

  const { error } = await createAdminClient()
    .from("ai_models")
    .upsert(
      { ...linha, synced_at: new Date().toISOString(), deprecated_at: null },
      { onConflict: "provider,model_id" },
    );
  if (error) {
    logger.error("[ai.providers.models.add] upsert falhou", { error: error.message, request_id: requestId });
    return fail("internal_error", "Erro ao gravar o modelo no catálogo.", 500, { requestId });
  }

  void audit({
    action: "ai.model_catalog_added",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_models",
    // `null` pelo mesmo motivo do sync: `resource_id` é uuid e o código do
    // modelo não é um. O identificador natural vai no metadata.
    resourceId: null,
    metadata: { provedor: provider, model_id: modelId },
    requestId,
  });

  return ok({ model: { ...linha, is_default_for_provider: false } }, { requestId });
}
