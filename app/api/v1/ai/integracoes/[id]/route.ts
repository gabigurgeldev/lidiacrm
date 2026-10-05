/**
 * GET    /api/v1/ai/integracoes/:id — a integração com os endpoints (manager+).
 * PATCH  /api/v1/ai/integracoes/:id — edita (admin).
 * DELETE /api/v1/ai/integracoes/:id — ARQUIVA (admin). Não apaga: o histórico
 *                                      de chamadas e de ações confirmadas aponta
 *                                      para ela.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { IntegracaoAtualizarSchema } from "@/lib/ai/integracoes/schema";
import { COLUNAS_DA_INTEGRACAO, COLUNAS_DO_ENDPOINT, carregarIntegracao } from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const integracao = await carregarIntegracao(admin, authz.org.orgId, id);
  if (!integracao) return fail("not_found", "Integração não encontrada.", 404, { requestId });
  const { data: endpoints } = await admin
    .from("ai_api_endpoints")
    .select(COLUNAS_DO_ENDPOINT)
    .eq("organization_id", authz.org.orgId)
    .eq("integration_id", id)
    .order("modo", { ascending: true })
    .order("slug", { ascending: true });
  return ok({ ...integracao, endpoints: endpoints ?? [] }, { requestId });
}

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = IntegracaoAtualizarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }
  const v = parsed.data;
  if (Object.keys(v).length === 0) return fail("invalid_request", "Body vazio.", 400, { requestId });

  const admin = createAdminClient();
  const atual = await carregarIntegracao(admin, authz.org.orgId, id);
  if (!atual) return fail("not_found", "Integração não encontrada.", 404, { requestId });
  if (atual.arquivada_em) return fail("invalid_state", "Integração arquivada.", 409, { requestId });

  // O endpoint de identidade tem de ser DESTA integração e do modo identidade.
  if (v.identidade_endpoint_id) {
    const { data: ep } = await admin
      .from("ai_api_endpoints")
      .select("id, modo")
      .eq("organization_id", authz.org.orgId)
      .eq("integration_id", id)
      .eq("id", v.identidade_endpoint_id)
      .maybeSingle();
    if (!ep || ep.modo !== "identidade") {
      return fail("validation_failed", "Escolha um endpoint de identidade desta integração.", 422, { requestId });
    }
  }

  const { data, error } = await admin
    .from("ai_api_integrations")
    .update({ ...v, updated_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .select(COLUNAS_DA_INTEGRACAO)
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail("state_conflict", "Já existe uma integração com esse nome.", 409, { requestId });
    return fail("internal_error", "Erro ao salvar a integração.", 500, { requestId });
  }
  await audit({
    action: "ai_api.integration_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_integration",
    resourceId: id,
    metadata: { campos: Object.keys(v) },
    requestId,
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_api_integrations")
    .update({ arquivada_em: new Date().toISOString(), ativo: false, updated_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .is("arquivada_em", null)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", "Erro ao arquivar.", 500, { requestId });
  if (!data) return fail("not_found", "Integração não encontrada.", 404, { requestId });
  await audit({
    action: "ai_api.integration_archived",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_integration",
    resourceId: id,
    requestId,
  });
  return ok({ id, arquivada: true }, { requestId });
}
