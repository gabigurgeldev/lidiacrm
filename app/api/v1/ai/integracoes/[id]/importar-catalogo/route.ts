/**
 * POST /api/v1/ai/integracoes/:id/importar-catalogo — só para integração do
 * tipo `suporte_v1` (admin). Lê `GET /suporte/v1/catalogo` e cria ou atualiza
 * os endpoints de origem `catalogo_suporte_v1`. Endpoint escrito à mão
 * (`origem = manual`) com o mesmo slug NÃO é sobrescrito: quem configurou na
 * tela decidiu, e a importação não desfaz a decisão em silêncio.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { explicarErro } from "@/lib/ai/integracoes/cliente-http";
import {
  TESTES_POR_MINUTO,
  buscarCatalogo,
  carregarIntegracao,
  endpointsDoCatalogo,
  lerSegredo,
  registrarChamadaDeTeste,
  testesNoUltimoMinuto,
} from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("admin", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const admin = createAdminClient();
  if ((await testesNoUltimoMinuto(admin, org)) >= TESTES_POR_MINUTO) {
    return fail("rate_limited", "Muitos testes em pouco tempo. Espere um minuto.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }
  const integracao = await carregarIntegracao(admin, org, id);
  if (!integracao || integracao.arquivada_em) return fail("not_found", "Integração não encontrada.", 404, { requestId });
  if (integracao.tipo !== "suporte_v1") {
    return fail("invalid_state", "Só integrações do Contrato de Suporte v1 têm catálogo.", 409, { requestId });
  }

  const segredo = await lerSegredo(admin, org, id);
  const r = await buscarCatalogo(integracao, segredo);
  await registrarChamadaDeTeste(admin, org, { integrationId: id, endpointId: null, origem: "importacao", resposta: r.resposta });
  if (!r.ok) {
    const msg = r.erro === "catalogo_invalido" ? "O sistema respondeu, mas o catálogo não segue o contrato." : explicarErro(r.erro);
    return fail("upstream_unavailable", msg, 502, { requestId });
  }

  const { data: existentes } = await admin
    .from("ai_api_endpoints")
    .select("id, slug, origem")
    .eq("organization_id", org)
    .eq("integration_id", id);
  const porSlug = new Map(((existentes ?? []) as Array<{ id: string; slug: string; origem: string }>).map((e) => [e.slug, e]));

  let criados = 0;
  let atualizados = 0;
  let mantidos = 0;
  let identidadeId: string | null = null;
  for (const ep of endpointsDoCatalogo(r.catalogo)) {
    const atual = porSlug.get(ep.slug);
    if (atual && atual.origem === "manual") {
      mantidos += 1;
      if (ep.modo === "identidade") identidadeId = atual.id;
      continue;
    }
    if (atual) {
      await admin
        .from("ai_api_endpoints")
        .update({ ...ep, updated_at: new Date().toISOString() })
        .eq("organization_id", org)
        .eq("id", atual.id);
      atualizados += 1;
      if (ep.modo === "identidade") identidadeId = atual.id;
    } else {
      const { data: novo } = await admin
        .from("ai_api_endpoints")
        .insert({ ...ep, organization_id: org, integration_id: id })
        .select("id")
        .single();
      criados += 1;
      if (ep.modo === "identidade" && novo) identidadeId = novo.id as string;
    }
  }

  await admin
    .from("ai_api_integrations")
    .update({ identidade_modo: "email_otp", identidade_endpoint_id: identidadeId, updated_at: new Date().toISOString() })
    .eq("organization_id", org)
    .eq("id", id);

  await audit({
    action: "ai_api.catalog_imported",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "ai_api_integration",
    resourceId: id,
    metadata: { sistema: r.catalogo.sistema, criados, atualizados, mantidos },
    requestId,
  });
  return ok({ sistema: r.catalogo.sistema, criados, atualizados, mantidos }, { requestId });
}
