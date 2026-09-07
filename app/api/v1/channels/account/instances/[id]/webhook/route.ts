/**
 * POST /api/v1/channels/account/instances/[id]/webhook — tenta de novo, sem
 * reimportar.
 *
 * O import só grava o webhook UMA vez, na hora de trazer a instância — e se a
 * chave da conta não tinha o escopo certo naquele momento (`instances:manage`,
 * diferente do `instances:read` que basta pra listar), o canal fica conectado
 * e SURDO, sem nenhuma forma de tentar de novo além de colar a chave inteira e
 * reimportar tudo. Esta rota resolve isso sozinha: reaproveita a credencial já
 * gravada na linha e manda o registro de novo. O operador só precisa corrigir
 * o escopo no painel do provedor e clicar.
 *
 * `[id]` é o id de `channel_sessions`, nunca o identificador do provedor — o
 * mesmo que a tela já usa pra excluir o canal.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { publicBase, reapontarWebhookDaConta } from "@/lib/channels/conta-de-instancias";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const r = await reapontarWebhookDaConta(admin, {
    organizationId: authz.org.orgId,
    channelSessionId: id,
    baseDoWebhook: publicBase(req).replace(/\/+$/, ""),
  });

  if (!r.ok) {
    const status = r.motivo === "canal não encontrado" ? 404 : 422;
    return fail(status === 404 ? "not_found" : "invalid_request", r.motivo, status, { requestId });
  }

  void audit({
    action: "channel.webhook_reconfigured",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
  });

  return ok({ recebendo: true }, { requestId });
}
