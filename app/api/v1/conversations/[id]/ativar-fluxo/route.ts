/**
 * POST /api/v1/conversations/[id]/ativar-fluxo — dispara um fluxo À MÃO para o
 * contato DESTA conversa (o botão "Ativar fluxo" do cabeçalho).
 *
 * É o outro lado do gatilho `trigger.manual`: o matcher nunca o arma (ele não
 * escuta o barramento), então quem cria a execução é esta rota.
 *
 * ─── Por que fica sob `conversations/`, e não sob `flows/` ──────────────────
 *
 * Disparar um fluxo JÁ publicado para o contato que se está atendendo é ação de
 * ATENDIMENTO (papel `agent`), não de autoria de fluxo (`manager`, que o
 * invariante `flows-rbac-alinhado` cobra em todo `/api/v1/flows`). O fluxo foi
 * montado e publicado por um manager; o agente só o aplica a este contato.
 *
 * O contato sai da CONVERSA (resolvido no servidor pelo `[id]`), nunca do corpo:
 * é o anti-pattern nº 10 da doutrina, e aqui evitaria que um agente disparasse
 * um fluxo para um contato que não é o desta conversa.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { acharNoDeGatilho, kindDoGatilho } from "@/lib/flow-engine/gatilho";
import { garantirNosRegistrados } from "@/lib/flow-engine/register-all";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const corpoSchema = z.strictObject({ flow_id: z.string().uuid() });

type Contexto = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversation_flow" });
  if (!authz.ok) return authz.response;
  const { id: conversationId } = await ctx.params;
  const orgId = authz.org.orgId;

  let cru: unknown = {};
  try {
    cru = await req.json();
  } catch {
    cru = {};
  }
  const parsed = corpoSchema.safeParse(cru);
  if (!parsed.success) {
    return fail("invalid_request", "Informe o flow_id.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const flowId = parsed.data.flow_id;

  garantirNosRegistrados();
  const supabase = await createClient();

  // A conversa precisa ser da org; o contato dela é quem recebe o fluxo.
  const { data: conv } = await supabase
    .from("conversations")
    .select("id, contact_id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();
  const conversa = conv as { id: string; contact_id: string | null } | null;
  if (!conversa) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  if (!conversa.contact_id) {
    return fail("invalid_request", "Esta conversa ainda não tem contato.", 422, { requestId });
  }
  const contactId = conversa.contact_id;

  // O fluxo tem de ser da org, estar ATIVO e ter versão publicada.
  const { data: fluxo } = await supabase
    .from("flows")
    .select("id, name, status, active_version_id")
    .eq("organization_id", orgId)
    .eq("id", flowId)
    .maybeSingle();
  const f = fluxo as
    | { id: string; name: string; status: string; active_version_id: string | null }
    | null;
  if (f === null) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });
  if (f.status !== "active" || f.active_version_id === null) {
    return fail("invalid_request", "Esse fluxo não está ligado. Ligue-o antes de disparar.", 422, {
      requestId,
    });
  }

  const { data: versao } = await supabase
    .from("flow_versions")
    .select("id, graph")
    .eq("organization_id", orgId)
    .eq("id", f.active_version_id)
    .maybeSingle();
  const v = versao as { id: string; graph: unknown } | null;
  if (v === null) {
    return fail("invalid_request", "A versão publicada do fluxo sumiu. Publique de novo.", 422, {
      requestId,
    });
  }

  // Só fluxo de ATIVAÇÃO MANUAL sai pelo botão: disparar à mão um fluxo que
  // escuta evento criaria uma execução fora da condição em que ele foi desenhado.
  if (kindDoGatilho(v.graph) !== "manual") {
    return fail(
      "invalid_request",
      "Esse fluxo não é de ativação manual — ele começa sozinho pelo gatilho dele.",
      422,
      { requestId },
    );
  }
  const gatilho = acharNoDeGatilho(v.graph);
  if (gatilho === null) {
    return fail("invalid_request", "O fluxo não tem bloco de início.", 422, { requestId });
  }

  // Idempotência: não empilha uma segunda execução do MESMO fluxo para o MESMO
  // contato enquanto a anterior não terminou. Cobre o clique duplo — a chave
  // `uniq_flow_executions_trigger_event` não protege aqui (trigger_event_id é
  // nulo no disparo manual, e nulos não colidem).
  const { data: emAndamento } = await supabase
    .from("flow_executions")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("flow_id", flowId)
    .eq("contact_id", contactId)
    .is("completed_at", null)
    .limit(1)
    .maybeSingle();
  if (emAndamento !== null) {
    return ok({ execucao: emAndamento, ja_estava_rodando: true }, { requestId, status: 200 });
  }

  const { data: exec, error: insErr } = await supabase
    .from("flow_executions")
    .insert({
      organization_id: orgId,
      flow_id: flowId,
      version_id: v.id,
      status: "pending",
      current_node_id: gatilho.id,
      // Vencida AGORA: o próximo tick do worker pega. Não é `null` porque o CHECK
      // de relógio recusa estado ativo sem hora (mesma regra do matcher).
      next_eval_at: new Date().toISOString(),
      contact_id: contactId,
      conversation_id: conversationId,
      trigger_event_id: null,
      lineage: { origem: "manual", user_id: authz.user.id },
      context: {},
    })
    .select("id, status, current_node_id, started_at")
    .single();

  if (insErr !== null) return fail("internal_error", insErr.message, 500, { requestId });

  void audit({
    action: "flow.started_manually",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "flow",
    resourceId: flowId,
    requestId,
    metadata: { execution_id: (exec as { id: string }).id, contact_id: contactId, flow_name: f.name },
  });

  return ok({ execucao: exec, ja_estava_rodando: false }, { requestId, status: 201 });
}
