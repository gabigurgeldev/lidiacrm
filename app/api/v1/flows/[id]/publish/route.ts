/**
 * POST /api/v1/flows/[id]/publish — congela o rascunho numa versão imutável.
 *
 * Publicar é o portão de "vai valer de verdade": a partir daqui o fluxo é
 * armado por evento real sobre lead real. Por isso a validação semântica roda
 * AQUI e não no salvamento (ver `validate-publish.ts`).
 *
 * O fluxo NÃO é ativado junto. Publicar e ligar são decisões diferentes: quem
 * publica quer ver o desenho congelado; quem liga aceita que ele comece a
 * mexer no funil. Juntar as duas tiraria do operador a chance de conferir.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { garantirGatilhosDeWebhook } from "@/lib/flow-engine/gatilho-por-webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { flowGraphSchema } from "@/lib/flow-engine/graph-schema";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { validarParaPublicar } from "@/lib/flow-engine/validate-publish";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  garantirNosRegistrados();
  const supabase = await createClient();

  const { data: fluxo } = await supabase
    .from("flows")
    .select("id, name, draft_graph")
    .eq("organization_id", authz.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (fluxo === null) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });

  const bruto = (fluxo as { draft_graph: unknown }).draft_graph;
  const forma = flowGraphSchema.safeParse(bruto);
  if (!forma.success) {
    return fail("invalid_request", "O fluxo ainda está vazio ou incompleto.", 422, {
      requestId,
      details: { erros: [{ ancora: "grafo", codigo: "grafo_ausente", mensagem: "Monte o fluxo antes de publicar." }] },
    });
  }

  const veredito = validarParaPublicar(forma.data);
  if (!veredito.ok) {
    // 422 com os erros ANCORADOS no bloco: a tela destaca o bloco culpado em
    // vez de mostrar um toast genérico que não diz onde consertar.
    return fail("invalid_request", "O fluxo tem pendências.", 422, {
      requestId,
      details: { erros: veredito.erros, avisos: veredito.avisos },
    });
  }

  const { data: ultima } = await supabase
    .from("flow_versions")
    .select("version_number")
    .eq("organization_id", authz.org.orgId)
    .eq("flow_id", id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const proximo = ((ultima as { version_number: number } | null)?.version_number ?? 0) + 1;

  const { data: versao, error: errVersao } = await supabase
    .from("flow_versions")
    .insert({
      organization_id: authz.org.orgId,
      flow_id: id,
      version_number: proximo,
      graph: forma.data,
      // Congelado JUNTO do grafo. O ponteiro pode mudar de gatilho amanhã, e a
      // execução em voo tem de continuar sabendo sob qual condição foi armada.
      trigger_config: { kind: "event" },
      published_by_user_id: authz.user.id,
    })
    .select("id, version_number, published_at")
    .single();

  if (errVersao !== null) {
    // Corrida: duas publicações no mesmo instante disputam `version_number`.
    if ((errVersao as { code?: string }).code === "23505") {
      return fail("conflict", "Alguém publicou este fluxo ao mesmo tempo. Tente de novo.", 409, {
        requestId,
      });
    }
    return fail("internal_error", errVersao.message, 500, { requestId });
  }

  const novaVersao = versao as { id: string; version_number: number; published_at: string };
  const { error: errPonteiro } = await supabase
    .from("flows")
    .update({ active_version_id: novaVersao.id, updated_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("id", id);
  if (errPonteiro) return fail("internal_error", errPonteiro.message, 500, { requestId });

  // O gatilho por webhook precisa de um endereço público, e ele nasce AQUI —
  // ao publicar, não ao arrastar o bloco: token criado no rascunho é endereço
  // vivo para fluxo que não roda. Melhor esforço de propósito (ver o cabeçalho
  // de `lib/flow-engine/gatilho-por-webhook.ts`): falhar em criar o token não
  // pode desfazer a publicação dos outros blocos, que não têm nada com isso.
  const gatilhos = await garantirGatilhosDeWebhook(createAdminClient(), {
    organizationId: authz.org.orgId,
    flowId: id,
    flowName: (fluxo as { name: string }).name,
    grafo: forma.data,
    criadoPorUserId: authz.user.id,
  });

  void audit({
    action: "flow.published",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "flow",
    resourceId: id,
    requestId,
    metadata: {
      version_number: novaVersao.version_number,
      avisos: veredito.avisos.length,
      gatilhos_de_webhook: gatilhos.length,
    },
  });

  return ok(
    // Os endereços dos gatilhos voltam na resposta: sem isto a pessoa publica
    // e não tem onde ler a URL que precisa colar no sistema de fora.
    { versao: novaVersao, avisos: veredito.avisos, gatilhos_de_webhook: gatilhos },
    { requestId, status: 201 },
  );
}
