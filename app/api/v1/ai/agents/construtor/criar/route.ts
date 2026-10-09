/**
 * POST /api/v1/ai/agents/construtor/criar — grava o que "Criar agente com IA"
 * montou e a pessoa revisou: materiais de conhecimento + agente com a versão 1
 * em RASCUNHO. Nunca publica.
 *
 * `organization_id` sai da sessão (`requireRole`), nunca do corpo — e o corpo é
 * `strict`, então um `organization_id` mandado nele é recusado, não ignorado.
 * Papel: admin, o mesmo de `POST /api/v1/ai/agents`.
 *
 * A lógica mora em `lib/ai/agents/construtor/criar.ts`; esta rota é a borda.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { criarAgenteDaPrevia } from "@/lib/ai/agents/construtor/criar";
import { previaSchema } from "@/lib/ai/agents/construtor/esquemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;

  const corpo = await req.json().catch(() => null);
  const lido = previaSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: lido.error.flatten() });
  }

  const r = await criarAgenteDaPrevia(
    createAdminClient(),
    { organizationId: authz.org.orgId, userId: authz.user.id, requestId },
    lido.data,
  );
  if (!r.ok) {
    return fail(r.code, r.message, r.status, {
      requestId,
      ...(r.materiais_criados ? { details: { materiais_criados: r.materiais_criados } } : {}),
    });
  }
  const { ok: _ok, ...dados } = r;
  return ok(dados, { status: 201, requestId });
}
