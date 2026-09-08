/**
 * POST /api/v1/flows/[id]/start — dispara um fluxo À MÃO para um contato.
 *
 * É o outro lado do `trigger.manual`: o matcher nunca arma esse gatilho (ele
 * não escuta o barramento), então quem cria a execução é esta rota, acionada
 * pelo botão “Ativar fluxo” dentro da conversa.
 *
 * RBAC `agent`: quem atende é quem dispara. Diferente de criar/publicar fluxo
 * (manager+, montar algo que fala com cliente sozinho) — aqui o fluxo JÁ foi
 * montado e publicado por um manager; o agente só o aplica a este contato.
 *
 * Escreve pela sessão do usuário (RLS), nunca pelo admin client: a policy
 * `tenant_isolation_flow_executions_all` já garante que a linha nasce na org do
 * usuário, e o `organization_id` explícito vem da org ATIVA resolvida do cookie
 * — nunca do corpo.
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

const corpoSchema = z.strictObject({
  contact_id: z.string().uuid(),
  conversation_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid().nullable().optional(),
});

type Contexto = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id: flowId } = await ctx.params;
  const orgId = authz.org.orgId;

  let cru: unknown = {};
  try {
    cru = await req.json();
  } catch {
    cru = {};
  }
  const parsed = corpoSchema.safeParse(cru);
  if (!parsed.success) {
    return fail("invalid_request", "Dados inválidos.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }
  const { contact_id, conversation_id, lead_id } = parsed.data;

  garantirNosRegistrados();
  const supabase = await createClient();

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

  // A versão publicada, e o nó por onde ela começa.
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

  // O contato tem de ser da org (RLS + filtro explícito).
  const { data: contato } = await supabase
    .from("contacts")
    .select("id")
    .eq("organization_id", orgId)
    .eq("id", contact_id)
    .maybeSingle();
  if (contato === null) return fail("not_found", "Contato não encontrado.", 404, { requestId });

  // Idempotência: não empilha uma segunda execução do MESMO fluxo para o MESMO
  // contato enquanto a anterior não terminou. Cobre o clique duplo e o disparo
  // repetido — a chave `uniq_flow_executions_trigger_event` não protege aqui
  // porque `trigger_event_id` é nulo no disparo manual (nulos não colidem).
  const { data: emAndamento } = await supabase
    .from("flow_executions")
    .select("id, status")
    .eq("organization_id", orgId)
    .eq("flow_id", flowId)
    .eq("contact_id", contact_id)
    .is("completed_at", null)
    .limit(1)
    .maybeSingle();
  if (emAndamento !== null) {
    return ok(
      { execucao: emAndamento, ja_estava_rodando: true },
      { requestId, status: 200 },
    );
  }

  const { data: exec, error: insErr } = await supabase
    .from("flow_executions")
    .insert({
      organization_id: orgId,
      flow_id: flowId,
      version_id: v.id,
      status: "pending",
      current_node_id: gatilho.id,
      // Vencida AGORA: o próximo tick do worker pega. Não é `null` porque o
      // CHECK de relógio recusa estado ativo sem hora (mesma regra do matcher).
      next_eval_at: new Date().toISOString(),
      contact_id,
      conversation_id: conversation_id ?? null,
      lead_id: lead_id ?? null,
      // Manual não tem evento de origem; nulo é o correto, e é o que faz a chave
      // de dedup de evento não se aplicar (por isso a guarda acima).
      trigger_event_id: null,
      lineage: { origem: "manual", user_id: authz.user.id },
      context: {},
    })
    .select("id, status, current_node_id, started_at")
    .single();

  if (insErr !== null) {
    return fail("internal_error", insErr.message, 500, { requestId });
  }

  void audit({
    action: "flow.started_manually",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "flow",
    resourceId: flowId,
    requestId,
    metadata: { execution_id: (exec as { id: string }).id, contact_id, flow_name: f.name },
  });

  return ok({ execucao: exec, ja_estava_rodando: false }, { requestId, status: 201 });
}
