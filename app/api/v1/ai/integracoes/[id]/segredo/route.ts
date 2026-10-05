/**
 * PUT /api/v1/ai/integracoes/:id/segredo — grava (ou troca) a chave de acesso
 * da integração (admin). Só escrita: a resposta devolve os últimos 4 caracteres,
 * e nenhuma rota devolve o segredo de volta.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { SegredoSchema } from "@/lib/ai/integracoes/schema";
import { carregarIntegracao, gravarSegredo } from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { chaveDeCifragemUtilizavel } from "@/lib/crypto/aes_gcm";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  const chave = chaveDeCifragemUtilizavel();
  if (!chave.ok) {
    return fail("ai_encryption_key_misconfigured", `Não dá para guardar segredo: ${chave.erro}. ${chave.comoCorrigir}`, 503, {
      requestId,
    });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = SegredoSchema.safeParse(raw);
  if (!parsed.success) return fail("validation_failed", "Informe a chave (4 a 4000 caracteres).", 422, { requestId });

  const admin = createAdminClient();
  const integracao = await carregarIntegracao(admin, authz.org.orgId, id);
  if (!integracao || integracao.arquivada_em) return fail("not_found", "Integração não encontrada.", 404, { requestId });

  const r = await gravarSegredo(admin, authz.org.orgId, id, parsed.data.segredo);
  if (!r.ok) return fail("internal_error", "Erro ao guardar a chave.", 500, { requestId });

  await audit({
    action: "ai_api.secret_rotated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_integration",
    resourceId: id,
    metadata: { last4: r.last4 },
    requestId,
  });
  return ok({ segredo_last4: r.last4 }, { requestId });
}
