/**
 * POST /api/v1/conversations/[id]/reopen — tira a conversa de "Fechadas" e a
 * devolve a uma aba da inbox, escolhida por quem clicou.
 *
 * Body: `{ destino: "fila" | "minhas" | "automatico" }`.
 *
 * ## Por que existe
 *
 * Fechar era uma porta só de ida. A conversa encerrada não tinha ação de volta:
 * o que havia eram efeitos colaterais — "Assumir" aparecia em fechada SEM dono e
 * a reabria como `claimed`; "Liberar" aparecia só para o dono e a reabria como
 * `open`. Quem não era nenhum dos dois não tinha como trazê-la de volta.
 *
 * ## Nenhum estado novo
 *
 * Cada destino é um caminho que JÁ existe, e por isso o efeito no motor é o
 * mesmo que o da ação equivalente numa conversa aberta:
 *
 *   * `minhas`     → `fn_conversation_assign` para quem clicou (reason='claim'):
 *                    status `claimed` + silêncio durável do automático.
 *   * `fila`       → `fn_conversation_assign` para ninguém (reason='release'):
 *                    status `open`; o silêncio só cai se não houve escalação.
 *   * `automatico` → `devolverAtendimentoAoAgente`, a mesma do "Devolver ao
 *                    automático". Ela NÃO reabre encerrada (de propósito — ver
 *                    `STATUS_REATIVAVEIS` em `lib/escalacao/retomada.ts`), então
 *                    a conversa vai antes para `open` e só depois é devolvida.
 *
 * Os dois primeiros usam o lock otimista da RPC contra o dono LIDO aqui: se
 * alguém mexeu na conversa no meio, a resposta é 409 e nada muda.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { audit } from "@/lib/audit";
import { ApiError } from "@/lib/api/types";
import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { devolverAtendimentoAoAgente } from "@/lib/escalacao/retomada";
import { registrarTrocaDeComando } from "@/lib/inbox/atividade-de-comando";
import { reopenConversationSchema, validateRequest } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import type { Conversation } from "@/lib/types/messaging";

export const dynamic = "force-dynamic";

/** Os estados de que "reabrir" tira a conversa. Os demais já estão abertos. */
const STATUS_ENCERRADOS = ["closed", "archived"] as const;

interface RouteCtx {
  params: Promise<{ id: string }>;
}

interface ConversaAtual {
  id: string;
  organization_id: string;
  contact_id: string | null;
  status: string;
  assigned_to_user_id: string | null;
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;

  // spec 13 §4: escrita é agent+ (viewer é read-only) — o mesmo piso de fechar.
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const user = authz.user;
  const orgId = authz.org.orgId;

  let input;
  try {
    input = await validateRequest(reopenConversationSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const supabase = await createClient();

  const { data: atualData, error: lerErr } = await supabase
    .from("conversations")
    .select("id, organization_id, contact_id, status, assigned_to_user_id")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (lerErr) return fail("internal_error", lerErr.message, 500, { requestId });
  if (!atualData) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  const atual = atualData as unknown as ConversaAtual;

  if (!(STATUS_ENCERRADOS as readonly string[]).includes(atual.status)) {
    return fail("state_conflict", "Esta conversa já está aberta.", 409, { requestId });
  }

  const actor = { type: "user" as const, id: user.id, role: authz.org.role };

  if (input.destino === "automatico") {
    // Primeiro reabre, depois devolve: a devolução preserva o status de uma
    // conversa encerrada, e chamá-la direto deixaria a conversa em "Fechadas".
    // O filtro de status é a guarda de corrida — se outra pessoa reabriu no
    // meio, este UPDATE não acha linha e nada é sobrescrito.
    const { data: reaberta, error: reabrirErr } = await supabase
      .from("conversations")
      .update({ status: "open", status_changed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", orgId)
      .in("status", [...STATUS_ENCERRADOS])
      .select("id")
      .maybeSingle();
    if (reabrirErr) return fail("internal_error", reabrirErr.message, 500, { requestId });
    if (!reaberta) {
      return fail("state_conflict", "Esta conversa já foi reaberta por outra pessoa.", 409, {
        requestId,
      });
    }

    const resultado = await devolverAtendimentoAoAgente(
      { supabase, organizationId: orgId, actor, requestId },
      { conversationId: id },
    );
    if (!resultado.ok) {
      // A conversa JÁ saiu de "Fechadas" (está na Fila, aberta). Dizer isso é o
      // que permite à pessoa terminar o gesto em vez de achar que nada mudou.
      return fail(
        "state_conflict",
        "A conversa foi reaberta na Fila, mas não voltou para o automático — tente “Devolver ao automático”.",
        409,
        { requestId },
      );
    }
  } else {
    const paraMim = input.destino === "minhas";
    const { data, error } = await supabase.rpc("fn_conversation_assign", {
      p_organization_id: orgId,
      p_conversation_id: id,
      // A função aceita null (types gerados não expõem a nulabilidade do arg).
      p_to_user_id: (paraMim ? user.id : null) as unknown as string,
      p_reason: paraMim ? "claim" : "release",
      p_expected_assignee: atual.assigned_to_user_id as unknown as string,
      p_enforce_expected: true,
    });
    if (error) return fail("internal_error", error.message, 500, { requestId });
    if (!data?.[0]) {
      return fail(
        "state_conflict",
        "Alguém mexeu nesta conversa agora — recarregue e tente de novo.",
        409,
        { requestId },
      );
    }

    await registrarTrocaDeComando({
      supabase,
      organizationId: orgId,
      conversationId: id,
      contactId: atual.contact_id,
      tipo: paraMim ? "conversation_claimed" : "conversation_released",
      actor,
      motivo: paraMim
        ? "Reabriu a conversa e assumiu o atendimento"
        : "Reabriu a conversa de volta para a fila",
    });
  }

  await audit({
    action: "conversation.reopened",
    actorUserId: user.id,
    organizationId: orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { destino: input.destino, status_anterior: atual.status },
  });

  const { data: final } = await supabase
    .from("conversations")
    .select(
      "id, organization_id, contact_id, channel_session_id, channel, status, status_changed_at, assigned_to_user_id, assigned_at, last_inbound_at, last_outbound_at, last_message_at, last_message_preview, unread_count_for_assignee, is_group, group_chat_id, metadata, created_at, updated_at",
    )
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();

  return ok({ conversation: (final ?? null) as Conversation | null, destino: input.destino }, {
    requestId,
  });
}
