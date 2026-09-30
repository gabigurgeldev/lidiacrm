/**
 * GET /api/v1/ai/providers/:provider/models/search?q= — busca AO VIVO na origem.
 *
 * O seletor de modelo lê `ai_models`, que só muda quando o cron diário roda.
 * Esta rota vai à própria OpenRouter (com memória curta — ver
 * `lib/ai/catalogo/origem-em-cache.ts`) e devolve o que casa com o termo, para
 * a pessoa achar o modelo lançado hoje sem esperar a madrugada.
 *
 * Não grava nada: escolher um resultado chama o POST de
 * `/api/v1/ai/providers/:provider/models`, que confere e grava. Cada resultado
 * diz se já está no catálogo (`no_catalogo`) para a tela não prometer
 * "adicionar" o que já está lá.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { ehProvedorSuportado, PROVEDORES } from "@/lib/ai/pontos/provedores";
import { buscarNoCatalogo } from "@/lib/ai/catalogo/openrouter";
import { catalogoDaOrigem } from "@/lib/ai/catalogo/origem-em-cache";
import { buscarDaOpenRouter } from "@/app/api/v1/cron/sync-model-catalog/route";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().trim().min(1).max(120) });

export async function GET(
  req: NextRequest,
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

  if (!PROVEDORES.find((p) => p.id === provider)?.catalogoSincronizavel || provider !== "openrouter") {
    return fail(
      "invalid_request",
      "este provedor não tem catálogo externo para buscar — os modelos dele já vêm prontos na instalação",
      422,
      { requestId },
    );
  }

  const parsed = querySchema.safeParse({ q: req.nextUrl.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return fail("validation_failed", "Digite o que procurar.", 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  let encontrados;
  try {
    encontrados = buscarNoCatalogo(await catalogoDaOrigem(buscarDaOpenRouter), parsed.data.q);
  } catch (err) {
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[ai.providers.models.search] origem falhou", { error: detalhe, request_id: requestId });
    return fail(
      "upstream_unavailable",
      "Não conseguimos falar com a OpenRouter agora. Tente de novo em instantes.",
      502,
      { requestId },
    );
  }

  const noCatalogo = new Set<string>();
  if (encontrados.length > 0) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("ai_models")
      .select("model_id")
      .eq("provider", provider)
      .is("deprecated_at", null)
      .in(
        "model_id",
        encontrados.map((m) => m.model_id),
      );
    for (const r of data ?? []) noCatalogo.add(r.model_id);
  }

  return ok(
    { models: encontrados.map((m) => ({ ...m, no_catalogo: noCatalogo.has(m.model_id) })) },
    { requestId },
  );
}
