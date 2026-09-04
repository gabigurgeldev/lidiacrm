/**
 * POST /api/v1/ai/providers/[provider]/sync — sincroniza o catálogo AGORA.
 *
 * ═══ O defeito que esta rota conserta ═══
 *
 * O catálogo da OpenRouter (`ai_models`, `catalogoSincronizavel: true` em
 * `lib/ai/pontos/provedores.ts`) só chegava por um cron diário
 * (`/api/v1/cron/sync-model-catalog`, 04:15, no container `scheduler`). Numa
 * instalação onde esse cron nunca rodou — `scheduler` que subiu depois, secret
 * ausente, primeiro dia da instalação — o seletor de modelo do agente ficava
 * "Nenhum modelo disponível" para sempre, sem NENHUM sinal na tela do porquê:
 * medido em produção, `select count(*) from ai_models where
 * provider='openrouter'` era **zero**, e a credencial da conta não tinha nada
 * a ver com isso — o catálogo é global da instalação, não por organização.
 *
 * ═══ Por que chama a MESMA função do cron, não uma cópia ═══
 *
 * `sincronizarCatalogo` (regra) e `buscarDaOpenRouter` (I/O) já são exportadas
 * de `app/api/v1/cron/sync-model-catalog/route.ts` — reescrever aqui seria o
 * anti-pattern nº 2 do CLAUDE.md (duplicação sem fonte única), e as duas
 * cópias divergiriam na primeira vez que o formato da origem mudasse. O cron
 * segue rodando diariamente para os ~400 modelos que mudam sozinhos; esta rota
 * é só o mesmo botão, puxado por uma pessoa em vez do relógio.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { buscarDaOpenRouter, sincronizarCatalogo } from "@/app/api/v1/cron/sync-model-catalog/route";
import { CatalogoSuspeitoError } from "@/lib/ai/catalogo/sincronizar";
import { ehProvedorSuportado, PROVEDORES } from "@/lib/ai/pontos/provedores";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_providers" });
  if (!authz.ok) return authz.response;

  const { provider } = await params;
  if (!ehProvedorSuportado(provider)) {
    return fail("invalid_request", "provedor desconhecido", 404, { requestId });
  }

  // Só a OpenRouter tem o que sincronizar: Anthropic/OpenAI/Google são
  // semeados por migration e não têm origem externa a consultar aqui — fingir
  // que têm devolveria "sincronizado" sem mudar nada, e ninguém entenderia
  // por que a lista continuou igual.
  const def = PROVEDORES.find((p) => p.id === provider);
  if (!def?.catalogoSincronizavel) {
    return fail(
      "invalid_request",
      "este provedor não tem catálogo sincronizável — os modelos dele já vêm prontos na instalação",
      422,
      { requestId },
    );
  }

  // Só a OpenRouter é sincronizável hoje (o `if` acima já garantiu isso), mas
  // a busca é nomeada por provider para o dia em que outro provider ganhar
  // `catalogoSincronizavel: true` não reaproveitar silenciosamente a busca
  // errada.
  if (provider !== "openrouter") {
    return fail("invalid_request", "sincronização deste provedor ainda não implementada", 501, {
      requestId,
    });
  }

  try {
    const resultado = await sincronizarCatalogo(createAdminClient(), buscarDaOpenRouter);
    logger.info("[ai.providers.sync] disparado manualmente", {
      ...resultado,
      actor_user_id: authz.user.id,
      request_id: requestId,
    });
    void audit({
      action: "ai.model_catalog_synced",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "ai_models",
      // ⚠️ `null`, e NÃO `provider`. `api_audit_log.resource_id` é `uuid`, e
      // "openrouter" não é um: o INSERT estourava. Audit é fire-and-forget, então
      // a sincronização seguia e a linha da trilha sumia — sem sintoma em tela
      // nenhuma. O identificador natural vai no metadata, que é texto livre.
      resourceId: null,
      metadata: { ...resultado, provedor: provider },
      requestId,
    });
    return ok(resultado, { requestId });
  } catch (err) {
    if (err instanceof CatalogoSuspeitoError) {
      // Não é falha do operador nem do servidor: a origem respondeu pouco, e o
      // piso de sanidade recusou a rodada para não depreciar o catálogo em
      // massa por um soluço de rede. 200 com o motivo — mesma resposta do cron.
      return ok({ recusado: true, motivo: err.message }, { requestId });
    }
    const detalhe = err instanceof Error ? err.message : String(err);
    logger.error("[ai.providers.sync] falhou", { error: detalhe, request_id: requestId });
    // 502: a falha é entre nós e a origem (OpenRouter), não um erro nosso de
    // lógica — é a diferença que diz ao operador se vale tentar de novo.
    return fail("upstream_unavailable", detalhe, 502, { requestId });
  }
}
