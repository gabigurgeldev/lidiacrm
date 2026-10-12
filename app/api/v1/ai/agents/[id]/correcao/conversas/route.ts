/**
 * GET /api/v1/ai/agents/:id/correcao/conversas — as conversas recentes em que
 * este agente atuou, para a pessoa apontar "foi nesta aqui" em "Corrigir com IA".
 *
 * Admin client, então tudo filtra a organização da sessão. Mostra o nome do
 * contato (quem é admin já o vê no inbox); o que vai ao MODELO é a conversa
 * mascarada, lida em `correcao/contexto.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { rotuloDoContato } from "@/lib/contacts/rotulo-do-contato";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONVERSAS = 15;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id: agentId } = await ctx.params;
  if (!UUID_RX.test(agentId)) return fail("invalid_request", "Agente inválido.", 400, { requestId });

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const admin = createAdminClient();

  const { data: agente } = await admin
    .from("ai_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!agente) return fail("not_found", "Agente não encontrado.", 404, { requestId });

  const { data: runs } = await admin
    .from("ai_agent_runs")
    .select("conversation_id, created_at")
    .eq("organization_id", orgId)
    .eq("agent_id", agentId)
    .eq("is_dry_run", false)
    .not("conversation_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  const ids: string[] = [];
  for (const r of (runs ?? []) as Array<{ conversation_id: string }>) {
    if (!ids.includes(r.conversation_id)) ids.push(r.conversation_id);
    if (ids.length === MAX_CONVERSAS) break;
  }
  if (ids.length === 0) return ok([], { requestId });

  const { data: conversas } = await admin
    .from("conversations")
    .select("id, contact_id, last_message_at")
    .eq("organization_id", orgId)
    .in("id", ids);
  const linhas = (conversas ?? []) as Array<{ id: string; contact_id: string; last_message_at: string | null }>;
  const { data: contatos } = await admin
    .from("contacts")
    .select("id, name, display_name, phone_number")
    .eq("organization_id", orgId)
    .in(
      "id",
      linhas.map((c) => c.contact_id),
    );
  // O rótulo do contato tem UMA regra no produto (`rotuloDoContato`).
  const nome = new Map(
    ((contatos ?? []) as Array<{ id: string; name: string | null; display_name: string | null; phone_number: string | null }>).map(
      (c) => [c.id, rotuloDoContato(c)],
    ),
  );

  // Na ordem em que o agente atuou (a mais recente primeiro), não na do banco.
  const porId = new Map(linhas.map((c) => [c.id, c]));
  const lista = ids.flatMap((id) => {
    const c = porId.get(id);
    return c ? [{ id: c.id, contato: nome.get(c.contact_id) ?? null, ultima_mensagem_em: c.last_message_at }] : [];
  });
  return ok(lista, { requestId });
}
