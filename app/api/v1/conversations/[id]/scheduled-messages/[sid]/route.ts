/**
 * DELETE /api/v1/conversations/[id]/scheduled-messages/[sid] — desmarca.
 *
 * Só o que ainda está `scheduled`: o que o cron já pegou (`sending`) ou já
 * saiu não se desmarca — responder "cancelado" para uma mensagem que está
 * saindo seria mentir. Nesse caso, 409.
 *
 * A linha não é apagada: vira `cancelled`, e o histórico do que foi marcado
 * e desfeito fica.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, noContent } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

interface RouteParams {
  params: Promise<{ id: string; sid: string }>;
}

export async function DELETE(_req: NextRequest, { params }: RouteParams): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "conversations" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;
  const { id, sid } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("conversation_scheduled_messages")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
    .eq("id", sid)
    .eq("conversation_id", id)
    .eq("organization_id", org.orgId)
    .eq("status", "scheduled")
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });

  if (!data) {
    const { data: existe } = await supabase
      .from("conversation_scheduled_messages")
      .select("status")
      .eq("id", sid)
      .eq("conversation_id", id)
      .eq("organization_id", org.orgId)
      .maybeSingle();
    if (!existe) return fail("not_found", "Agendamento não encontrado.", 404, { requestId });
    return fail("state_conflict", "Essa mensagem já está saindo ou já saiu.", 409, { requestId });
  }

  void audit({
    action: "conversation.scheduled_message_cancelled",
    actorUserId: user.id,
    organizationId: org.orgId,
    resourceType: "conversation",
    resourceId: id,
    requestId,
    metadata: { scheduled_message_id: sid },
  });
  return noContent(requestId);
}
