/**
 * POST /api/v1/ai/integracoes/:id/endpoints/:eid/testar — chama o endpoint com
 * valores de exemplo e mostra o que o AGENTE veria (já projetado e redigido).
 *
 * Leitura: manager+. AÇÃO: só admin, e só com `executar_de_verdade: true` — o
 * teste de uma ação altera o sistema de verdade, e a tela pede confirmação
 * antes de mandar isso.
 *
 * `conta_de_teste` preenche `{{conta.id}}`/`{{conta.email}}` para quem quer
 * testar um endpoint que exige identidade — é o operador, logado, testando o
 * próprio sistema; o cliente do WhatsApp nunca passa por aqui.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { explicarErro } from "@/lib/ai/integracoes/cliente-http";
import { projetarResposta } from "@/lib/ai/integracoes/projecao";
import { construirValidadorDeParametros, lerParametros } from "@/lib/ai/integracoes/schema";
import {
  TESTES_POR_MINUTO,
  carregarEndpoint,
  carregarIntegracao,
  lerSegredo,
  registrarChamadaDeTeste,
  testarEndpoint,
  testesNoUltimoMinuto,
} from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string; eid: string }> };

const BodySchema = z
  .object({
    parametros: z.record(z.string(), z.unknown()).default({}),
    conta_de_teste: z
      .object({ id: z.string().trim().min(1).max(200), email: z.string().trim().max(254).default("") })
      .optional(),
    executar_de_verdade: z.boolean().default(false),
  })
  .strict();

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id, eid } = await ctx.params;
  if (!UUID_RX.test(id) || !UUID_RX.test(eid)) return fail("invalid_request", "ids inválidos.", 400, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "ai_api_endpoints" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const body = BodySchema.safeParse(raw);
  if (!body.success) return fail("validation_failed", "Campos inválidos.", 422, { requestId });

  const admin = createAdminClient();
  const integracao = await carregarIntegracao(admin, org, id);
  const endpoint = integracao ? await carregarEndpoint(admin, org, id, eid) : null;
  if (!integracao || !endpoint) return fail("not_found", "Endpoint não encontrado.", 404, { requestId });

  if (endpoint.modo === "acao") {
    if (authz.org.role !== "admin") {
      return fail("forbidden_role", "Só quem administra pode testar uma ação.", 403, { requestId });
    }
    if (!body.data.executar_de_verdade) {
      return fail("invalid_request", "Testar uma ação altera o sistema de verdade. Confirme para executar.", 409, {
        requestId,
      });
    }
  }
  if ((await testesNoUltimoMinuto(admin, org)) >= TESTES_POR_MINUTO) {
    return fail("rate_limited", "Muitos testes em pouco tempo. Espere um minuto.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }

  const val = construirValidadorDeParametros(lerParametros(endpoint.parametros)).safeParse(body.data.parametros);
  if (!val.success) {
    return fail("validation_failed", `Parâmetros inválidos: ${val.error.issues.map((i) => i.message).join("; ")}`, 422, {
      requestId,
    });
  }

  const segredo = await lerSegredo(admin, org, id);
  const r = await testarEndpoint({
    integracao,
    endpoint,
    segredo,
    valores: val.data,
    contaDeTeste: body.data.conta_de_teste ?? null,
  });
  if (!r.ok) {
    const msg =
      r.montagem === "identidade_necessaria"
        ? "Este endpoint usa a conta verificada: informe uma conta de teste."
        : "O pedido não pôde ser montado com esses valores.";
    return ok({ ok: false, mensagem: msg, codigo: r.montagem }, { requestId });
  }

  await registrarChamadaDeTeste(admin, org, { integrationId: id, endpointId: eid, origem: "teste", resposta: r.resposta });
  await audit({
    action: "ai_api.endpoint_tested",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "ai_api_endpoint",
    resourceId: eid,
    metadata: { modo: endpoint.modo, http_status: r.resposta.http_status, executou_acao: endpoint.modo === "acao" },
    requestId,
  });

  return ok(
    {
      ok: r.resposta.ok,
      http_status: r.resposta.http_status,
      duracao_ms: r.resposta.duracao_ms,
      mensagem: r.resposta.ok ? "O sistema respondeu." : explicarErro(r.resposta.erro_codigo),
      // O que o agente receberia — projetado e com segredos ocultos.
      o_que_o_agente_ve: r.resposta.ok ? projetarResposta(r.resposta.dados, endpoint.campos_da_resposta) : null,
    },
    { requestId },
  );
}
