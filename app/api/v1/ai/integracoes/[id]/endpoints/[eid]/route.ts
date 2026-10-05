/**
 * PATCH  /api/v1/ai/integracoes/:id/endpoints/:eid — edita (admin).
 * DELETE /api/v1/ai/integracoes/:id/endpoints/:eid — apaga (admin). Versões de
 *        agente que o marcavam deixam de carregá-lo; a tela do agente mostra.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { EndpointAtualizarSchema } from "@/lib/ai/integracoes/schema";
import { COLUNAS_DO_ENDPOINT, carregarEndpoint } from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; eid: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, eid } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(eid)) return fail("invalid_request", "ids inválidos.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_endpoints" });
  if (!authz.ok) return authz.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }

  const admin = createAdminClient();
  const atual = await carregarEndpoint(admin, authz.org.orgId, id, eid);
  if (!atual) return fail("not_found", "Endpoint não encontrado.", 404, { requestId });

  // Coerência confere o RESULTADO (atual + mudança), não só a mudança: trocar
  // o modo para `acao` sem texto de confirmação tem de ser recusado aqui.
  const parsed = EndpointAtualizarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }
  const resultado = EndpointAtualizarSchema.safeParse({
    modo: atual.modo,
    caminho: atual.caminho,
    parametros: atual.parametros,
    exige_identidade: atual.exige_identidade,
    texto_de_confirmacao: atual.texto_de_confirmacao,
    ...parsed.data,
  });
  if (!resultado.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: resultado.error.flatten() });
  }

  const { data, error } = await admin
    .from("ai_api_endpoints")
    // Editado na tela vira `manual`: a próxima importação de catálogo respeita.
    .update({ ...parsed.data, origem: "manual", updated_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", eid)
    .select(COLUNAS_DO_ENDPOINT)
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail("state_conflict", "Já existe um endpoint com esse identificador.", 409, { requestId });
    return fail("internal_error", "Erro ao salvar o endpoint.", 500, { requestId });
  }
  await audit({
    action: "ai_api.endpoint_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_endpoint",
    resourceId: eid,
    metadata: { integration_id: id, campos: Object.keys(parsed.data) },
    requestId,
  });
  return ok(data, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, eid } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(eid)) return fail("invalid_request", "ids inválidos.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_endpoints" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const atual = await carregarEndpoint(admin, authz.org.orgId, id, eid);
  if (!atual) return fail("not_found", "Endpoint não encontrado.", 404, { requestId });

  const { error } = await admin.from("ai_api_endpoints").delete().eq("organization_id", authz.org.orgId).eq("id", eid);
  if (error) return fail("internal_error", "Erro ao apagar o endpoint.", 500, { requestId });
  await audit({
    action: "ai_api.endpoint_deleted",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_endpoint",
    resourceId: eid,
    metadata: { integration_id: id, slug: atual.slug },
    requestId,
  });
  return ok({ id: eid, apagado: true }, { requestId });
}
