/**
 * POST /api/v1/bulk-sends/[id]/cancel — encerrar um disparo de vez.
 *
 * Terminal: não há caminho de volta. Quem quiser falar com o resto da lista cria
 * um disparo novo — e é melhor assim, porque o dossiê deste continua contando a
 * verdade do que aconteceu enquanto ele existiu.
 *
 * ═══ Os pendentes ficam `pending`, e isso é deliberado ═══
 *
 * A tentação é marcá-los como `skipped` para os contadores "fecharem". Seria
 * mentira duas vezes: `skipped` significa "decidimos não mandar para esta
 * pessoa, por este motivo dela" — e o motivo aqui não é dela, é da campanha ter
 * sido cancelada. E o CHECK do banco cobra motivo em todo `skipped`, então a
 * mentira precisaria inventar um. "Estes nunca foram enviados" é a leitura
 * honesta, e é a que a tela mostra.
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
  const orgId = authz.org.orgId;
  const { id } = await ctx.params;

  const supabase = await createClient();

  // Quantos ficaram sem receber — entra na trilha porque cancelar um disparo em
  // voo é a ação que alguém pode querer negar ter feito, e "quantos faltavam"
  // é o dado que a torna avaliável depois.
  const { data: pendentes } = await supabase
    .from("bulk_send_recipients")
    .select("id")
    .eq("bulk_send_id", id)
    .eq("organization_id", orgId)
    .in("status", ["pending", "sending"]);

  const resultado = await transicionar(supabase, {
    id,
    organizationId: orgId,
    de: ["draft", "scheduled", "running", "paused"],
    patch: {
      status: "cancelled",
      next_send_at: null,
      claimed_until: null,
      finished_at: new Date().toISOString(),
      pause_reason: null,
      pause_detail: null,
    },
  });

  if (!resultado.ok) {
    return fail("invalid_state_transition", fraseDaRecusa("cancelar", resultado.estadoAtual), 409, {
      requestId,
    });
  }

  await audit({
    action: "bulk_send.cancelled",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "bulk_send",
    resourceId: id,
    requestId,
    metadata: { nunca_enviados: (pendentes ?? []).length },
  });

  return ok({ id, status: "cancelled", nunca_enviados: (pendentes ?? []).length }, { requestId });
}
