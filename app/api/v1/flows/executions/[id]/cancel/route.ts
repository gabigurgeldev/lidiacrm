/**
 * POST /api/v1/flows/executions/[id]/cancel — para uma execução em andamento.
 *
 * Não existia, e a falta apareceu em produção (2026-10-08): uma triagem armada
 * por engano ficou esperando a resposta de um menu e calando o agente de IA
 * naquela conversa (`silencia_ia`, migration 0228). A única saída era o cliente
 * responder o menu inteiro, ou esperar o prazo vencer — uma hora sem resposta.
 *
 * O que "cancelar" faz:
 *  - a execução vira `cancelled` (terminal, sem relógio — o CHECK de relógio
 *    exige isso), e sai da fila do motor e do gate da IA na hora;
 *  - as frentes vivas viram `cancelled`, sem espera por evento: o acordador não
 *    as encontra mais, e a próxima mensagem do cliente não as acorda;
 *  - um passo `execucao_cancelada` entra na trilha, para quem abrir a execução
 *    ver POR QUE ela parou, e quem parou.
 *
 * Só execução VIVA (`pending`/`running`/`waiting`/`paused`). Cancelar uma que
 * já terminou é 409, não um no-op silencioso: quem clicou achou que ela rodava.
 *
 * Admin client com `organization_id` da sessão (nunca do corpo) — a mesma
 * regra de toda rota que usa service role.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const VIVAS = ["pending", "running", "waiting", "paused"];

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flow_executions" });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const orgId = authz.org.orgId;
  const admin = createAdminClient();
  const agora = new Date().toISOString();

  const { data: cancelada, error } = await admin
    .from("flow_executions")
    .update({
      status: "cancelled",
      outcome: "cancelada_por_pessoa",
      next_eval_at: null,
      claimed_until: null,
      completed_at: agora,
      updated_at: agora,
    })
    .eq("organization_id", orgId)
    .eq("id", id)
    .in("status", VIVAS)
    .select("id, flow_id, status, current_node_id")
    .maybeSingle();

  if (error) return fail("internal_error", error.message, 500, { requestId });

  if (!cancelada) {
    const { data: existe } = await admin
      .from("flow_executions")
      .select("status")
      .eq("organization_id", orgId)
      .eq("id", id)
      .maybeSingle();
    if (!existe) return fail("not_found", "Execução não encontrada.", 404, { requestId });
    return fail("state_conflict", "Esta execução já terminou.", 409, { requestId });
  }

  const c = cancelada as { id: string; flow_id: string; current_node_id: string | null };

  // As frentes: sem isto, uma frente esperando "message.received" seguiria
  // registrada, e o acordador a encontraria na próxima mensagem do cliente.
  const { error: frentesErr } = await admin
    .from("flow_execution_frames")
    .update({
      status: "cancelled",
      next_eval_at: null,
      claimed_until: null,
      awaiting_event_type: null,
      awaiting_match: null,
      wait_deadline: null,
      updated_at: agora,
    })
    .eq("organization_id", orgId)
    .eq("execution_id", id)
    .in("status", ["ready", "waiting"]);
  if (frentesErr) {
    return fail("internal_error", `Execução parada, frentes não: ${frentesErr.message}`, 500, { requestId });
  }

  // A trilha diz por que parou. Falhar aqui não desfaz o cancelamento.
  await admin.from("flow_execution_events").insert({
    organization_id: orgId,
    execution_id: id,
    node_id: c.current_node_id,
    event_type: "execucao_cancelada",
    payload: { por: authz.user.id },
    idempotency_key: `cancelada:${id}`,
  });

  void audit({
    action: "flow.execution_cancelled",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "flow_execution",
    resourceId: id,
    requestId,
    metadata: { flow_id: c.flow_id },
  });

  return ok({ id, status: "cancelled" }, { requestId });
}
