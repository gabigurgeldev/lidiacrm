/**
 * POST /api/v1/bulk-sends/[id]/resume — continuar um disparo pausado.
 *
 * Retoma de onde parou, sem repetir ninguém: a fila é `bulk_send_recipients`
 * com `status='pending'`, e quem já recebeu está `sent`. A campanha É o cursor.
 *
 * Rota própria em vez de reusar `/start` porque a TRILHA precisa distinguir: um
 * `bulk_send.started` para o que foi retomado faria quem lê a auditoria depois
 * concluir que a campanha saiu duas vezes.
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
    de: ["paused"],
    patch: {
      status: "running",
      // Relógio em `agora`: o próximo tique já reclama. O pacing continua
      // mandando no ritmo — retomar não é acelerar.
      next_send_at: new Date().toISOString(),
      claimed_until: null,
      pause_reason: null,
      pause_detail: null,
    },
  });

  if (!resultado.ok) {
    return fail("invalid_state_transition", fraseDaRecusa("continuar", resultado.estadoAtual), 409, {
      requestId,
    });
  }

  await audit({
    action: "bulk_send.resumed",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "bulk_send",
    resourceId: id,
    requestId,
  });

  return ok({ id, status: "running" }, { requestId });
}
