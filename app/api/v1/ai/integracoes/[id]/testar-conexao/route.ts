/**
 * POST /api/v1/ai/integracoes/:id/testar-conexao — chama o sistema de verdade
 * (manager+) e grava o resultado na própria integração, para a lista mostrar a
 * saúde sem precisar testar de novo.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { explicarErro } from "@/lib/ai/integracoes/cliente-http";
import {
  TESTES_POR_MINUTO,
  carregarIntegracao,
  lerSegredo,
  registrarChamadaDeTeste,
  testarConexao,
  testesNoUltimoMinuto,
} from "@/lib/ai/integracoes/servidor";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });
  const authz = await requireRole("manager", { requestId, resource: "ai_api_integrations" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  if ((await testesNoUltimoMinuto(admin, authz.org.orgId)) >= TESTES_POR_MINUTO) {
    return fail("rate_limited", "Muitos testes em pouco tempo. Espere um minuto.", 429, {
      requestId,
      headers: { "Retry-After": "60" },
    });
  }
  const integracao = await carregarIntegracao(admin, authz.org.orgId, id);
  if (!integracao || integracao.arquivada_em) return fail("not_found", "Integração não encontrada.", 404, { requestId });

  const segredo = await lerSegredo(admin, authz.org.orgId, id);
  const r = await testarConexao(integracao, segredo);
  const mensagem = r.ok ? r.mensagem : r.mensagem || explicarErro(r.resposta.erro_codigo) || "O sistema não respondeu.";

  await registrarChamadaDeTeste(admin, authz.org.orgId, {
    integrationId: id,
    endpointId: null,
    origem: "teste",
    resposta: r.resposta,
  });
  await admin
    .from("ai_api_integrations")
    .update({
      ultimo_teste_em: new Date().toISOString(),
      ultimo_teste_ok: r.ok,
      ultimo_teste_erro: r.ok ? null : mensagem.slice(0, 300),
      ...(r.ok ? { falhas_consecutivas: 0, circuito_aberto_ate: null } : {}),
    })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);

  return ok(
    { ok: r.ok, mensagem, http_status: r.resposta.http_status, duracao_ms: r.resposta.duracao_ms },
    { requestId },
  );
}
