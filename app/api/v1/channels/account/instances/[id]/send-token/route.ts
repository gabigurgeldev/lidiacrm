/**
 * PUT /api/v1/channels/account/instances/[id]/send-token — o token de ENVIO de
 * um canal da modalidade oficial.
 *
 * A conexão por credencial de conta descobre tudo sozinha, menos isto: a API de
 * conta não devolve o token de envio de uma instância oficial (`token: null` em
 * todas elas, medido; preenchido em todas as por QR), porque a modalidade
 * oficial fala com outro serviço. O operador copia esse token do painel do
 * provedor e cola aqui, uma vez por canal.
 *
 * Sem ele, o canal recebe e não envia — que era o estado até esta rota existir.
 *
 * `[id]` é o id de `channel_sessions`, como nas rotas irmãs — nunca o
 * identificador do provedor. O caminho é NEUTRO pelo invariante 1 da doutrina
 * `restricao-de-canal`: quem nomeia provider é `lib/channels/`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { gravarTokenDeEnvioDaConta } from "@/lib/channels/conta-de-instancias";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const corpoSchema = z.object({
  // Sem `max` apertado nem formato: o token é do provedor e o comprimento dele
  // não é contrato nosso. O piso só recusa campo vazio antes de gastar uma ida
  // à rede — quem julga o valor é o provedor, no `GET /v1/health`.
  token: z.string().trim().min(8).max(500),
});

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("admin", { requestId, resource: "channels_partner" });
  if (!authz.ok) return authz.response;

  const parsed = corpoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", "token é obrigatório", 422, { requestId });
  }

  const admin = createAdminClient();
  const r = await gravarTokenDeEnvioDaConta(admin, {
    organizationId: authz.org.orgId,
    channelSessionId: id,
    token: parsed.data.token,
  });

  if (!r.ok) {
    const naoAchou = r.motivo === "canal não encontrado";
    return fail(naoAchou ? "not_found" : "invalid_request", r.motivo, naoAchou ? 404 : 422, {
      requestId,
    });
  }

  void audit({
    action: "channel.send_token_updated",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
  });

  // O token NUNCA volta, nem mascarado. O que volta é o que ele PROVA: qual
  // número ele alcança e se esse número entrega para qualquer um (`LIVE`) ou só
  // para os de teste (`SANDBOX`) — que é a diferença que some até a primeira
  // mensagem não chegar.
  return ok({ numero: r.numero, modo: r.modo }, { requestId });
}
