/**
 * POST /api/v1/ai/agents/:id/correcao/aplicar — "Corrigir com IA", passo 3.
 *
 * O que a pessoa manteve marcado vira RASCUNHO do agente. Nunca publica. A
 * lógica (e o porquê de cada recusa) mora em `lib/ai/agents/correcao/aplicar.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { aplicarCorrecao } from "@/lib/ai/agents/correcao/aplicar";
import { entradaDaAplicacaoSchema } from "@/lib/ai/agents/correcao/esquemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id: agentId } = await ctx.params;
  if (!UUID_RX.test(agentId)) return fail("invalid_request", "Agente inválido.", 400, { requestId });

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;

  const lido = entradaDaAplicacaoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "A correção enviada não é válida.", 422, { requestId, details: lido.error.flatten() });
  }

  const r = await aplicarCorrecao(
    createAdminClient(),
    { organizationId: authz.org.orgId, userId: authz.user.id, requestId },
    agentId,
    lido.data,
  );
  if (!r.ok) return fail(r.code, r.message, r.status, { requestId });
  const { ok: _ok, ...dados } = r;
  return ok(dados, { requestId });
}
