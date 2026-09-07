/**
 * GET /api/v1/flows/executions/[id]/events — a trilha, passo a passo.
 *
 * `flow_execution_events` grava um evento por nó visitado desde a migration
 * 0203 (índice `idx_flow_execution_events_trilha` em `(execution_id,
 * created_at)`), e até aqui **nenhuma rota a expunha**. A trilha existia,
 * completa, e só era legível por quem abrisse o banco.
 *
 * É ela que responde "onde o fluxo está agora" e — o motivo de esta rota
 * existir — "quanto tempo levou entre um passo e outro". Foi exatamente essa
 * leitura que mediu a lentidão que o laço do motor consertou: 0,9s entre dois
 * nós e 59,1s na retomada.
 *
 * Sem paginação de propósito: a trilha é limitada pelo teto de passos da
 * própria execução, não pelo tempo. Uma execução não cresce sem fim.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TETO_DE_EVENTOS = 500;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flow_executions" });
  if (!authz.ok) return authz.response;

  const { id } = await params;
  const supabase = await createClient();

  // `organization_id` na consulta mesmo com RLS: o cliente daqui é o do
  // usuário (a RLS já recorta), e o filtro explícito é o que a doutrina do
  // repo pede em toda consulta que cruza tabela tenant-aware — defesa em
  // profundidade, não redundância.
  const { data, error } = await supabase
    .from("flow_execution_events")
    .select("id, node_id, event_type, payload, created_at")
    .eq("organization_id", authz.org.orgId)
    .eq("execution_id", id)
    .order("created_at", { ascending: true })
    .limit(TETO_DE_EVENTOS);

  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok(data ?? [], { requestId });
}
