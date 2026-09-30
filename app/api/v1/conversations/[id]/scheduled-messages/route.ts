/**
 * GET  /api/v1/conversations/[id]/scheduled-messages — o que está marcado para
 *      sair nesta conversa (só `scheduled`, do mais próximo ao mais distante).
 * POST /api/v1/conversations/[id]/scheduled-messages — marca uma mensagem.
 *
 * Lembrar → "Agendar mensagem…" (migration 0220). O envio é do cron
 * `scheduled-messages`; aqui só se grava o pedido.
 *
 * Client do usuário (RLS): a policy de escrita exige `agent`+, e a mesma régua
 * está no `requireRole`. `organization_id` vem da sessão, nunca do corpo; o
 * contato vem da CONVERSA, não do corpo — o atendente escolhe o número e o
 * texto, não para quem vai.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { ARCHIVED_AT, queryTolerantToMissingArchived } from "@/lib/channels/archived";
import { HORIZONTE_MAXIMO_MS, criarMensagemAgendadaSchema } from "@/lib/schemas/mensagem-agendada";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const COLUNAS =
  "id, conversation_id, channel_session_id, body, scheduled_for, notify_phone, notify_body, status, failure_reason, created_by_user_id, created_at, sent_at";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { org } = authz;
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_scheduled_messages")
    .select(COLUNAS)
    .eq("organization_id", org.orgId)
    .eq("conversation_id", id)
    .eq("status", "scheduled")
    .order("scheduled_for", { ascending: true })
    .limit(50);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  return ok(data ?? [], { requestId });
}

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id } = await params;

  const raw = await req.json().catch(() => null);
  const parsed = criarMensagemAgendadaSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Dados inválidos.", 422, {
      requestId,
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
    });
  }
  const input = parsed.data;

  const quando = new Date(input.scheduled_for).getTime();
  const agora = Date.now();
  // Um minuto de folga: quem escolhe "agora" no relógio da tela não pode ser
  // recusado por segundos de relógio entre o navegador e o servidor.
  if (quando < agora - 60_000) {
    return fail("validation_failed", "Escolha um horário no futuro.", 422, {
      requestId,
      details: { scheduled_for: ["Escolha um horário no futuro."] },
    });
  }
  if (quando > agora + HORIZONTE_MAXIMO_MS) {
    return fail("validation_failed", "Dá para agendar até um ano à frente.", 422, {
      requestId,
      details: { scheduled_for: ["Dá para agendar até um ano à frente."] },
    });
  }

  const supabase = await createClient();

  const { data: conversa, error: convErr } = await supabase
    .from("conversations")
    .select("id, contact_id, is_group, contacts:contact_id(is_blocked, is_anonymized)")
    .eq("id", id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (convErr) return fail("internal_error", convErr.message, 500, { requestId });
  if (!conversa) return fail("not_found", "Conversa não encontrada.", 404, { requestId });
  const c = conversa as unknown as {
    id: string;
    contact_id: string;
    is_group: boolean;
    contacts: { is_blocked: boolean; is_anonymized: boolean | null } | null;
  };
  if (c.is_group) {
    return fail("validation_failed", "Não dá para agendar mensagem em grupo.", 422, { requestId });
  }
  if (c.contacts?.is_blocked) {
    return fail("forbidden", "O cliente bloqueou o atendimento.", 403, { requestId });
  }
  if (c.contacts?.is_anonymized) {
    return fail("forbidden", "Contato anonimizado não recebe mensagens.", 403, { requestId });
  }

  // O número tem de ser DESTA organização e não excluído. Sem queda para outro
  // número: a pessoa escolheu por qual linha o cliente vai ser lembrado.
  const { data: numero } = await queryTolerantToMissingArchived(
    () =>
      supabase
        .from("channel_sessions")
        .select(`id, ${ARCHIVED_AT}`)
        .eq("id", input.channel_session_id)
        .eq("organization_id", org.orgId)
        .maybeSingle(),
    () =>
      supabase
        .from("channel_sessions")
        .select("id")
        .eq("id", input.channel_session_id)
        .eq("organization_id", org.orgId)
        .maybeSingle(),
  );
  const n = numero as { id: string; archived_at?: string | null } | null;
  if (!n || n.archived_at) {
    return fail("validation_failed", "Escolha um número conectado.", 422, {
      requestId,
      details: { channel_session_id: ["Número não encontrado."] },
    });
  }

  const { data: criada, error } = await supabase
    .from("conversation_scheduled_messages")
    .insert({
      organization_id: org.orgId,
      conversation_id: c.id,
      contact_id: c.contact_id,
      channel_session_id: n.id,
      body: input.body,
      scheduled_for: new Date(quando).toISOString(),
      notify_phone: input.notify?.phone ?? null,
      notify_body: input.notify?.body ?? null,
      created_by_user_id: user.id,
    })
    .select(COLUNAS)
    .single();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: "conversation.message_scheduled",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: c.id,
    requestId,
    metadata: {
      scheduled_message_id: (criada as { id: string }).id,
      scheduled_for: new Date(quando).toISOString(),
      channel_session_id: n.id,
      com_aviso: Boolean(input.notify),
    },
  });
  return ok(criada, { requestId, status: 201 });
}
