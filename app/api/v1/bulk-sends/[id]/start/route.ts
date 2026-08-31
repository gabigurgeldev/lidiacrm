/**
 * POST /api/v1/bulk-sends/[id]/start — o botão que manda mensagem para N pessoas.
 *
 * É a ação irreversível desta feature: depois daqui a mensagem sai, e não volta.
 * Por isso ela é `manager`+, tem rate limit próprio e audita separado de
 * `bulk_send.created` — agendar e disparar são intenções diferentes, e uma
 * campanha pode nascer e nunca sair.
 *
 * `scheduled` vs `running` é só o relógio: com `scheduled_for` no futuro a
 * campanha espera a hora (o cron a promove); sem, `next_send_at = agora` e o
 * próximo tique já a reclama.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { iniciarDisparoSchema } from "@/lib/schemas";
import { createClient } from "@/lib/supabase/server";
import { fraseDaRecusa, transicionar } from "../_transicao";

export const dynamic = "force-dynamic";

/** Dez disparos iniciados por hora numa organização. Acima disso é engano. */
const TETO_POR_HORA = 10;
const JANELA_SEGUNDOS = 3600;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = req.headers.get("x-request-id") ?? randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "bulk_sends" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id } = await ctx.params;

  const lido = iniciarDisparoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Data de agendamento inválida.", 422, { requestId });
  }

  const limite = await checkRateLimit(`bulk-send-start:${orgId}`, TETO_POR_HORA, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail(
      "rate_limited",
      "Muitos disparos iniciados seguidos. Tente daqui a pouco.",
      429,
      { requestId, headers: { "Retry-After": String(JANELA_SEGUNDOS) } },
    );
  }

  const supabase = await createClient();
  const agora = new Date();
  const agendado = lido.data.scheduled_for ? new Date(lido.data.scheduled_for) : null;
  const noFuturo = agendado !== null && agendado.getTime() > agora.getTime();

  const resultado = await transicionar(supabase, {
    id,
    organizationId: orgId,
    // `paused` NÃO entra aqui: retomar tem rota e ação de auditoria próprias
    // (`/resume`, `bulk_send.resumed`). Tecnicamente seria a mesma transição —
    // mas a trilha diria "iniciado" para o que foi RETOMADO, e a trilha existe
    // justamente para quem lê depois saber o que aconteceu de verdade.
    de: ["draft", "scheduled"],
    patch: noFuturo
      ? {
          status: "scheduled",
          scheduled_for: agendado.toISOString(),
          // `scheduled` não é reclamado pelo claim (que só olha `running`);
          // quem o promove é `promoverAgendados` na hora certa.
          next_send_at: null,
          pause_reason: null,
          pause_detail: null,
        }
      : {
          status: "running",
          scheduled_for: null,
          next_send_at: agora.toISOString(),
          started_at: agora.toISOString(),
          pause_reason: null,
          pause_detail: null,
        },
  });

  if (!resultado.ok) {
    return fail("invalid_state_transition", fraseDaRecusa("disparar", resultado.estadoAtual), 409, {
      requestId,
    });
  }

  await audit({
    action: "bulk_send.started",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "bulk_send",
    resourceId: id,
    requestId,
    metadata: { agendado_para: noFuturo ? agendado.toISOString() : null },
  });

  return ok({ id, status: noFuturo ? "scheduled" : "running" }, { requestId });
}
