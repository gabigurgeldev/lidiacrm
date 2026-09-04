/**
 * GET /api/v1/flows/executions — o que rodou, e o que parou.
 *
 * É a tela de Execuções E a de Erros: `?status=dead` é a fila de erro. Não há
 * tabela de dead-letter separada — `flow_executions.status='dead'` já É a fila,
 * e uma tabela paralela seria a mesma verdade em dois lugares.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

const ESTADOS = ["pending", "running", "waiting", "paused", "completed", "cancelled", "dead"];

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flow_executions" });
  if (!authz.ok) return authz.response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const flowId = url.searchParams.get("flow_id");
  const cru = Number(url.searchParams.get("limit") ?? LIMITE_PADRAO);
  const limite = Number.isFinite(cru) ? Math.min(Math.max(Math.trunc(cru), 1), LIMITE_MAXIMO) : LIMITE_PADRAO;

  if (status !== null && !ESTADOS.includes(status)) {
    return fail("invalid_request", "Estado desconhecido.", 400, { requestId });
  }

  const supabase = await createClient();
  let q = supabase
    .from("flow_executions")
    .select(
      // O CONTATO vem embutido, e não como id solto: a tela precisa dizer QUEM
      // disparou o fluxo, e resolver nome por id do lado do cliente seria uma
      // consulta por linha. `crm_leads(contact_id)` é o desempate — `contact_id`
      // é nulo quando o gatilho foi só de lead (ver `trigger-matcher.ts`, que só
      // o preenche quando o payload do evento o traz).
      "id, flow_id, version_id, status, current_node_id, outcome, last_error, attempts, steps_taken, lead_id, contact_id, started_at, completed_at, next_eval_at, " +
        "contato:contact_id(id, display_name, name, phone_number), " +
        "lead:lead_id(id, title, contact_id, contato:contact_id(id, display_name, name, phone_number))",
    )
    .eq("organization_id", authz.org.orgId);
  if (status !== null) q = q.eq("status", status);
  if (flowId !== null) q = q.eq("flow_id", flowId);

  const { data, error } = await q.order("started_at", { ascending: false }).limit(limite);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(data ?? [], { requestId, meta: { has_more: (data ?? []).length === limite } });
}
