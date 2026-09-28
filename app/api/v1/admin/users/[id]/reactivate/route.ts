/**
 * POST /api/v1/admin/users/[id]/reactivate — desfaz a suspensão da conta.
 *
 * `ban_duration: "none"` tira o banimento; `app_metadata.suspensao` volta a
 * `null`. O histórico de quem suspendeu e por quê fica no audit.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { estadoDaConta, hashDeEmail } from "@/lib/admin/gestao-usuarios";
import { exigirPlatformAdmin } from "@/lib/admin/rota-da-plataforma";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const admin = createAdminClient();
  const { data: alvo, error: getErr } = await admin.auth.admin.getUserById(id);
  if (getErr || !alvo?.user) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const bannedUntil = (alvo.user as { banned_until?: string | null }).banned_until ?? null;
  const estado = estadoDaConta({
    banned_until: bannedUntil,
    email_confirmed_at: alvo.user.email_confirmed_at ?? null,
    last_sign_in_at: alvo.user.last_sign_in_at ?? null,
  });
  if (estado !== "suspenso") {
    return fail("state_conflict", "Esta conta não está suspensa.", 409, {
      requestId,
      details: { motivo: "estado" },
    });
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(id, {
    ban_duration: "none",
    app_metadata: { ...(alvo.user.app_metadata ?? {}), suspensao: null },
  });
  if (updErr) {
    return fail("internal_error", "Não consegui reativar a conta agora.", 500, {
      requestId,
      details: updErr.message,
    });
  }

  void audit({
    action: "platform_admin.user_reactivated",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "user",
    resourceId: id,
    requestId,
    metadata: { email_hash: hashDeEmail(alvo.user.email) },
  });

  return ok({ id, status: "ativo" }, { requestId });
}
