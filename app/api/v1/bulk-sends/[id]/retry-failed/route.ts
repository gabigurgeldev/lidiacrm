/**
 * POST /api/v1/bulk-sends/[id]/retry-failed — tentar de novo quem FALHOU.
 *
 * ═══ A regra de conformidade desta rota ═══
 *
 * Só `failed` volta para a fila. `skipped` NUNCA — e a distinção é o motivo de
 * as duas colunas existirem separadas:
 *
 *   * `failed` é do mundo: o transporte caiu, o número estava desconectado, a
 *     plataforma recusou. Nada disso é decisão sobre a pessoa, e tentar de novo
 *     é o certo.
 *   * `skipped` é decisão nossa sobre a PESSOA: ela pediu para parar, recusou
 *     marketing, foi anonimizada a pedido dela. Reenviar para essas seria o
 *     produto ajudando a furar um opt-out registrado.
 *
 * Por isso o `in("status", ["failed"])` não é uma otimização de query — é o
 * gate. A tela também não oferece o botão nessas linhas
 * (`tentarDeNovo: false` em `lib/bulk-send/frases.ts`), mas a tela é
 * conveniência: quem manda é aqui.
 *
 * ═══ Por que reabre o MESMO disparo, e não cria outro ═══
 *
 * Porque a lista já existe e o unique `(bulk_send_id, contact_id)` já garante
 * que ninguém receba duas vezes. Um disparo novo duplicaria a lista e perderia
 * essa trava — e teria de decidir o que fazer com os `sent`, que é a pergunta
 * que não se quer ter de responder.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

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

  const { data: disparo } = await supabase
    .from("bulk_sends")
    .select("status")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!disparo) return fail("not_found", "Disparo não encontrado.", 404, { requestId });
  if ((disparo as { status: string }).status === "cancelled") {
    return fail(
      "invalid_state_transition",
      "Este disparo foi cancelado. Crie um disparo novo para falar com quem faltou.",
      409,
      { requestId },
    );
  }

  const { data: voltaram, error } = await supabase
    .from("bulk_send_recipients")
    .update({ status: "pending", error: null, message_id: null, sent_at: null })
    .eq("bulk_send_id", id)
    .eq("organization_id", orgId)
    // O gate. Ver o cabeçalho: `skipped` não entra, por conformidade.
    .eq("status", "failed")
    .select("id");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  const quantos = (voltaram ?? []).length;
  if (quantos === 0) {
    return fail("no_actions_to_resend", "Não há falhas para tentar de novo.", 409, { requestId });
  }

  // Reabre o disparo com relógio: `done` sem `next_send_at` nunca seria
  // reclamado, e as linhas voltariam para uma fila que ninguém consome.
  const agora = new Date().toISOString();
  const { error: erroDisparo } = await supabase
    .from("bulk_sends")
    .update({
      status: "running",
      next_send_at: agora,
      finished_at: null,
      claimed_until: null,
      pause_reason: null,
      pause_detail: null,
      updated_at: agora,
    })
    .eq("id", id)
    .eq("organization_id", orgId);
  if (erroDisparo) return fail("internal_error", erroDisparo.message, 500, { requestId });

  await audit({
    action: "bulk_send.retried",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "bulk_send",
    resourceId: id,
    requestId,
    metadata: { destinatarios: quantos },
  });

  return ok({ id, status: "running", voltaram_para_a_fila: quantos }, { requestId });
}
