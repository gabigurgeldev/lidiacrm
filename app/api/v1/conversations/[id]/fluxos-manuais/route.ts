/**
 * GET /api/v1/conversations/[id]/fluxos-manuais — os fluxos que o botão "Ativar
 * fluxo" desta conversa pode disparar.
 *
 * São os fluxos LIGADOS de gatilho `trigger.manual` (kind espelhado no ponteiro
 * `flows.trigger_config` pela publicação). Fica sob `conversations/` e é `agent`
 * pelo mesmo motivo do `ativar-fluxo` ao lado: é o seletor de uma ação de
 * atendimento, não a tela de autoria de fluxo (que é `manager`, em `/api/v1/flows`).
 *
 * Devolve só id+name — o seletor não é lugar de vazar rascunho nem configuração.
 * O `[id]` da conversa entra para escopar a ação ao atendimento; a lista em si é
 * dos fluxos manuais da org.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Contexto = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Contexto): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversation_flow" });
  if (!authz.ok) return authz.response;
  const { id: conversationId } = await ctx.params;
  const orgId = authz.org.orgId;

  const supabase = await createClient();

  // A conversa precisa ser da org (escopo do atendimento).
  const { data: conv } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!conv) return fail("not_found", "Conversa não encontrada.", 404, { requestId });

  const { data, error } = await supabase
    .from("flows")
    .select("id, name")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .eq("trigger_config->>kind", "manual")
    .order("name", { ascending: true });

  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}
