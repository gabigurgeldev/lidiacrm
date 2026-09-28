/**
 * POST /api/v1/admin/users/[id]/suspend — suspende a CONTA na instalação.
 *
 * Suspender é bloquear o login em todas as organizações de uma vez, e é
 * reversível (`/reactivate`). Remover de UMA organização é outra ação:
 * `DELETE /api/v1/admin/users/[id]/memberships/[orgId]`.
 *
 * Mecanismo: `ban_duration` do GoTrue. Conta banida não faz login e não
 * renova sessão (o refresh token é recusado). ⚠️ O access token JÁ EMITIDO
 * segue válido até expirar (o `jwt_expiry` do Auth, 1h por padrão): a
 * suspensão corta a pessoa em no máximo esse tempo, não no mesmo segundo.
 *
 * Motivo, autor e data vão para `app_metadata.suspensao` — escrito só pela
 * service role — além do audit.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { situacaoDePlataforma } from "@/lib/admin/consultas-gestao";
import {
  DURACAO_DA_SUSPENSAO,
  estadoDaConta,
  hashDeEmail,
  recusaDeAcaoNaConta,
  type SuspensaoRegistrada,
} from "@/lib/admin/gestao-usuarios";
import { exigirPlatformAdmin, lerCorpo } from "@/lib/admin/rota-da-plataforma";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const suspenderSchema = z.object({
  reason: z.string().trim().min(10, "Mínimo 10 caracteres").max(500),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const corpo = await lerCorpo(suspenderSchema, req, requestId);
  if (!corpo.ok) return corpo.response;

  const admin = createAdminClient();
  const { data: alvo, error: getErr } = await admin.auth.admin.getUserById(id);
  if (getErr || !alvo?.user) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const plataforma = await situacaoDePlataforma(admin, id);
  if ("erro" in plataforma) {
    return fail("internal_error", "Não consegui conferir a conta agora.", 500, { requestId });
  }

  const bannedUntil = (alvo.user as { banned_until?: string | null }).banned_until ?? null;
  const recusa = recusaDeAcaoNaConta({
    acao: "suspender",
    atorId: gate.ctx.user.id,
    alvoId: id,
    ...plataforma,
    alvoJaSuspenso:
      estadoDaConta({
        banned_until: bannedUntil,
        email_confirmed_at: alvo.user.email_confirmed_at ?? null,
        last_sign_in_at: alvo.user.last_sign_in_at ?? null,
      }) === "suspenso",
  });
  if (recusa) {
    return fail("state_conflict", recusa.message, 409, {
      requestId,
      details: { motivo: recusa.motivo },
    });
  }

  const suspensao: SuspensaoRegistrada = {
    motivo: corpo.dados.reason,
    por: gate.ctx.user.id,
    em: new Date().toISOString(),
  };

  const { error: updErr } = await admin.auth.admin.updateUserById(id, {
    ban_duration: DURACAO_DA_SUSPENSAO,
    app_metadata: { ...(alvo.user.app_metadata ?? {}), suspensao },
  });
  if (updErr) {
    return fail("internal_error", "Não consegui suspender a conta agora.", 500, {
      requestId,
      details: updErr.message,
    });
  }

  void audit({
    action: "platform_admin.user_suspended",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "user",
    resourceId: id,
    requestId,
    metadata: { email_hash: hashDeEmail(alvo.user.email), reason: corpo.dados.reason },
  });

  return ok({ id, status: "suspenso", suspensao }, { requestId });
}
