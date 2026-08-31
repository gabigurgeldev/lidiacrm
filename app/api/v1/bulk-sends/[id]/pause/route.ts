/**
 * POST /api/v1/bulk-sends/[id]/pause — parar um disparo em voo.
 *
 * `next_send_at = null` junto com o estado: `paused` COM relógio seria
 * reclamado pelo claim e voltaria a enviar sozinho — o contrário do que a
 * pessoa acabou de pedir.
 *
 * `claimed_until = null` também, e não é detalhe: um lease vivo faria o tique
 * já em curso terminar a rodada dele. Zerá-lo é o que faz a pausa valer AGORA.
 * O destinatário que já está em `sending` termina — a mensagem dele já saiu, e
 * não há como despedi-la.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fraseDaRecusa, transicionar } from "../_transicao";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const { id } = await ctx.params;

  const supabase = await createClient();
  const resultado = await transicionar(supabase, {
    id,
    organizationId: authz.org.orgId,
    de: ["running", "scheduled"],
    patch: {
      status: "paused",
      next_send_at: null,
      claimed_until: null,
      pause_reason: "operador",
      pause_detail: "Pausado por você. Continue quando quiser — retoma de onde parou.",
    },
  });

  if (!resultado.ok) {
    return fail("invalid_state_transition", fraseDaRecusa("pausar", resultado.estadoAtual), 409, {
      requestId,
    });
  }

  await audit({
    action: "bulk_send.paused",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "bulk_send",
    resourceId: id,
    requestId,
  });

  return ok({ id, status: "paused" }, { requestId });
}
