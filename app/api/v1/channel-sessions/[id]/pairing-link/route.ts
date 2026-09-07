/**
 * POST   /api/v1/channel-sessions/[id]/pairing-link — gera o link público.
 * DELETE /api/v1/channel-sessions/[id]/pairing-link — cancela o link vivo.
 *
 * O QR só existia dentro do CRM, logado. Como ele expira em ~20s, mandar print
 * para o cliente não funciona: chega morto. Este link deixa o dono do número
 * abrir a página de pareamento no próprio celular.
 *
 * `manager` e não `admin`: quem conduz a ativação do cliente costuma ser quem
 * fala com ele. A hierarquia é `viewer < agent < manager < admin`, então admin
 * entra junto. **Decisão do dono do produto** — e ela amplia quem pode vincular
 * um WhatsApp novo à operação, o que é exatamente por que as duas ações auditam.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { canalParaParear } from "@/lib/channels/pareamento/canal";
import { VALIDADE_DO_LINK_MS } from "@/lib/channels/pareamento/link";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A base pública desta instalação, como o import de instâncias já a resolve. */
function baseDaInstalacao(req: NextRequest): string {
  const daEnv = process.env.NEXT_PUBLIC_APP_URL;
  if (daEnv) return daEnv.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("manager", { requestId, resource: "channels" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const admin = createAdminClient();
  // O seam resolve tudo o que exigiria nomear o provider aqui — e recusa canal
  // excluído e canal sem QR pelas razões já pagas na rota de QR autenticada.
  const canal = await canalParaParear(admin, orgId, id);
  if (!canal.ok) {
    if (canal.motivo === "nao_encontrado") {
      return fail("not_found", "canal não encontrado", 404, { requestId });
    }
    const frase =
      canal.motivo === "arquivado" ? "este canal foi excluído" : "este canal não conecta por QR";
    return fail("invalid_request", frase, 422, { requestId });
  }

  const agora = new Date();
  // Revoga o link vivo anterior ANTES de criar: dois links vivos para a mesma
  // linha é uma porta a mais sem utilidade nenhuma — o segundo já faz tudo o
  // que o primeiro fazia.
  await admin
    .from("channel_pairing_links")
    .update({ revoked_at: agora.toISOString() })
    .eq("organization_id", orgId)
    .eq("channel_session_id", id)
    .is("revoked_at", null)
    .is("consumed_at", null);

  const { data: criado, error } = await admin
    .from("channel_pairing_links")
    .insert({
      organization_id: orgId,
      channel_session_id: id,
      expires_at: new Date(agora.getTime() + VALIDADE_DO_LINK_MS).toISOString(),
      created_by: authz.user.id,
    })
    .select("token, expires_at")
    .single();

  if (error || !criado) {
    return fail("internal_error", "não deu para gerar o link agora", 500, { requestId });
  }

  const linha = criado as { token: string; expires_at: string };

  void audit({
    action: "channel.pairing_link_created",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
  });

  // O token vai no corpo UMA vez, montado em URL. Ele não é recuperável depois
  // por nenhuma rota: quem fechou a tela sem copiar gera outro, que é mais
  // barato que ter uma rota que devolve credencial viva.
  return ok(
    {
      url: `${baseDaInstalacao(req)}/pair/${linha.token}`,
      expira_em: linha.expires_at,
    },
    { requestId },
  );
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID();
  const { id } = await params;

  const authz = await requireRole("manager", { requestId, resource: "channels" });
  if (!authz.ok) return authz.response;

  const admin = createAdminClient();
  const { error } = await admin
    .from("channel_pairing_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", authz.org.orgId)
    .eq("channel_session_id", id)
    .is("revoked_at", null)
    .is("consumed_at", null);

  if (error) return fail("internal_error", "não deu para cancelar o link agora", 500, { requestId });

  void audit({
    action: "channel.pairing_link_revoked",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
  });

  // Idempotente: cancelar um link que já morreu responde igual. Quem clica
  // "Cancelar" duas vezes não precisa saber a diferença.
  return ok({ cancelado: true }, { requestId });
}
