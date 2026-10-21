/**
 * GET /api/v1/search — a busca global do ⌘K (handler em ./_handler.ts)
 *
 * Thin wrapper: auth + Zod + ok/fail, no molde de `app/api/v1/contacts/route.ts`.
 *
 * ── Sem audit, e isso é a regra e não um esquecimento ────────────────────────
 *
 * `api_audit_log` registra MUTAÇÃO (POST/PATCH/DELETE). Auditar um GET que
 * dispara a cada 250ms de digitação encheria a tabela de linhas sem decisão
 * dentro — é a mesma erosão que o CLAUDE.md documenta nas rodadas de cron que
 * não fizeram nada.
 *
 * ── Sem limitador de taxa próprio ────────────────────────────────────────────
 *
 * A rota é autenticada, e nenhuma rota `v1` deste repo tem limitador — pôr um
 * só aqui criaria um padrão de um arquivo. O custo é contido por construção: a
 * consulta só sai com 2+ caracteres (o schema recusa menos), o cliente espera
 * 250ms de silêncio antes de perguntar, e o teto é de 10 linhas POR TIPO.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { searchQuerySchema } from "@/lib/schemas/search";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

import { buscaGlobalHandler } from "./_handler";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supabase = await createClient();
  // `loadAuthUser()` valida o JWT com `getUser()`, nunca `getSession()` (que
  // confia no cookie local) — regra do CLAUDE.md, sem exceção. E é a ÚNICA ida
  // ao GoTrue desta rota: um `getUser()` solto antes dele dobrava a conta.
  const user = await loadAuthUser();
  if (!user) {
    return fail("unauthenticated", "Auth required.", 401, { requestId });
  }

  const url = new URL(req.url);
  const parsed = searchQuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Consulta inválida.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }

  const orgId = (await resolveActiveOrg(user))?.orgId;
  // ⚠️ Sem organização ativa a resposta é VAZIA, nunca "busque em tudo". Um
  // `organization_id` indefinido num filtro é o caminho mais curto para uma
  // busca que atravessa inquilinos — e a RLS sozinha ainda devolveria as linhas
  // de todas as organizações de quem pertence a várias.
  if (!orgId) {
    return ok({ results: [], parciais: false }, { requestId });
  }

  try {
    const saida = await buscaGlobalHandler(supabase, { organization_id: orgId }, parsed.data);
    if (saida.parciais) {
      // Não é erro de resposta: o cliente recebeu o que deu para achar. Mas é
      // erro de sistema, e sem este registro ele seria invisível — a tela
      // mostraria menos resultados e ninguém saberia por quê.
      logger.warn("busca global: uma das fontes falhou; resposta parcial", {
        requestId,
        organizationId: orgId,
      });
    }
    return ok(saida, { requestId });
  } catch (err) {
    logger.error("busca global falhou", {
      requestId,
      organizationId: orgId,
      detalhe: err instanceof Error ? err.message : String(err),
    });
    return fail("internal_error", "Não foi possível buscar agora.", 500, { requestId });
  }
}
