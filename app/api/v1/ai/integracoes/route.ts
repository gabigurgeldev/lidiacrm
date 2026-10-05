/**
 * GET  /api/v1/ai/integracoes — integrações da org ativa (manager+), com a
 *                                contagem de endpoints e a saúde.
 * POST /api/v1/ai/integracoes — cria uma integração (admin). O segredo vai por
 *                                `PUT .../segredo`, nunca no corpo da criação.
 *
 * Auth: cookie session. organization_id do JWT — nunca do body.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { IntegracaoCriarSchema } from "@/lib/ai/integracoes/schema";
import { COLUNAS_DA_INTEGRACAO } from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  const incluirArquivadas = req.nextUrl.searchParams.get("include_archived") === "true";
  const admin = createAdminClient();
  let q = admin
    .from("ai_api_integrations")
    .select(`${COLUNAS_DA_INTEGRACAO}, ai_api_endpoints(id, modo, ativo)`)
    .eq("organization_id", authz.org.orgId);
  if (!incluirArquivadas) q = q.is("arquivada_em", null);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) return fail("internal_error", "Erro ao listar integrações.", 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = IntegracaoCriarSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }
  const v = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_api_integrations")
    .insert({
      organization_id: authz.org.orgId,
      nome: v.nome,
      descricao: v.descricao ?? null,
      tipo: v.tipo,
      base_url: v.base_url,
      auth_tipo: v.auth_tipo,
      auth_header_nome: v.auth_header_nome ?? null,
      identidade_modo: v.identidade_modo,
      sessao_horas: v.sessao_horas,
      ativo: v.ativo,
      created_by: authz.user.id,
    })
    .select(COLUNAS_DA_INTEGRACAO)
    .single();
  if (error || !data) {
    if (error?.code === "23505") {
      return fail("state_conflict", "Já existe uma integração com esse nome.", 409, { requestId });
    }
    return fail("internal_error", "Erro ao criar a integração.", 500, { requestId });
  }

  await audit({
    action: "ai_api.integration_created",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "ai_api_integration",
    resourceId: data.id,
    metadata: { tipo: v.tipo, host: new URL(v.base_url).host, auth_tipo: v.auth_tipo },
    requestId,
  });
  return ok(data, { requestId, status: 201 });
}
