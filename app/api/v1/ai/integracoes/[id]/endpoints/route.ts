/**
 * GET  /api/v1/ai/integracoes/:id/endpoints — endpoints da integração (manager+).
 * POST /api/v1/ai/integracoes/:id/endpoints — cria um endpoint (admin).
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { EndpointCriarSchema } from "@/lib/ai/integracoes/schema";
import { COLUNAS_DO_ENDPOINT, carregarIntegracao } from "@/lib/ai/integracoes/servidor";
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
  const authz = await requireRole("manager", { requestId, resource: "ai_api_endpoints" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_api_endpoints")
    .select(COLUNAS_DO_ENDPOINT)
    .eq("organization_id", authz.org.orgId)
    .eq("integration_id", id)
    .order("slug", { ascending: true });
  if (error) return fail("internal_error", "Erro ao listar endpoints.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_endpoints" });
  if (!authz.ok) return authz.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = EndpointCriarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  const integracao = await carregarIntegracao(admin, authz.org.orgId, id);
  if (!integracao || integracao.arquivada_em) return fail("not_found", "Integração não encontrada.", 404, { requestId });

  const { data, error } = await admin
    .from("ai_api_endpoints")
    .insert({
      ...parsed.data,
      corpo_fixo: parsed.data.corpo_fixo ?? null,
      texto_de_confirmacao: parsed.data.texto_de_confirmacao ?? null,
      organization_id: authz.org.orgId,
      integration_id: id,
      origem: "manual",
    })
    .select(COLUNAS_DO_ENDPOINT)
    .single();
  if (error || !data) {
    if (error?.code === "23505") return fail("state_conflict", "Já existe um endpoint com esse identificador.", 409, { requestId });
    return fail("internal_error", "Erro ao criar o endpoint.", 500, { requestId });
  }

  // O primeiro endpoint de identidade vira o da integração, sem passo extra.
  if (data.modo === "identidade" && !integracao.identidade_endpoint_id) {
    await admin
      .from("ai_api_integrations")
      .update({ identidade_endpoint_id: data.id, updated_at: new Date().toISOString() })
      .eq("organization_id", authz.org.orgId)
      .eq("id", id);
  }

  await audit({
    action: "ai_api.endpoint_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_endpoint",
    resourceId: data.id,
    metadata: { integration_id: id, slug: data.slug, modo: data.modo, metodo: data.metodo },
    requestId,
  });
  return ok(data, { requestId, status: 201 });
}
