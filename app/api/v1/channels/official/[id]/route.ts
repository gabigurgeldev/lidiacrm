/**
 * PATCH /api/v1/channels/official/[id] — renomeia UM canal oficial.
 *
 * ─── Por que uma rota só para o apelido ────────────────────────────────────
 *
 * Porque com vários números o nome deixa de ser enfeite. O nome que a Meta
 * devolve é o `verifiedName` da empresa, e ele é o MESMO para todos os números
 * da mesma conta: dois canais oficiais chegam à tela como duas linhas com o
 * texto idêntico, e o operador escolhe o número de saída no escuro. Trocar o
 * apelido pelo `POST` de conexão obrigaria a colar o token de novo — o segredo
 * não volta em nenhum GET, então "renomear" custaria uma ida à Meta.
 *
 * ─── Por que NÃO há DELETE aqui ────────────────────────────────────────────
 *
 * Porque excluir canal já tem dono: `DELETE /api/v1/channel-sessions/[id]`, que
 * faz o preflight de impacto (quantas conversas, mensagens e configurações
 * seriam afetadas), decide entre arquivar e apagar, apaga a credencial, ROTACIONA
 * o `webhook_path_token` — que é o que de fato corta a entrega da Meta — e
 * audita. Uma segunda porta de exclusão aqui teria que repetir tudo isso, e a
 * cópia que esquecesse a rotação deixaria a plataforma entregando num canal
 * "excluído".
 */
import { randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { CHANNEL_PROVIDER_META } from "@/lib/channels/capabilities";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const renomearSchema = z.object({
  display_name: z.string().trim().min(1).max(80),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "channels_official" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;
  const { id } = await ctx.params;

  const parsed = renomearSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid_request", "display_name é obrigatório", 422, { requestId });
  }

  const admin = createAdminClient();
  // ⚠️ Service role bypassa RLS: o filtro por organização é MANUAL e vem do
  // cookie de sessão, nunca do corpo. Sem ele, um id vazado renomearia canal de
  // outra instalação. O filtro por provider evita que esta rota vire uma porta
  // lateral para renomear canal de outro tipo sem passar pelas regras dele.
  const { data, error } = await admin
    .from("channel_sessions")
    .update({ display_name: parsed.data.display_name })
    .eq("id", id)
    .eq("organization_id", orgId)
    .eq("provider", CHANNEL_PROVIDER_META)
    .select("id, display_name")
    .maybeSingle();

  if (error) {
    return fail("internal_error", error.message ?? "channel_session_write_failed", 500, {
      requestId,
    });
  }
  if (!data) return fail("not_found", "canal não encontrado", 404, { requestId });

  void audit({
    action: "channel.renamed",
    actorUserId: authz.user.id,
    organizationId: orgId,
    resourceType: "channel_session",
    resourceId: id,
    requestId,
    metadata: { display_name: parsed.data.display_name },
  });

  return ok(data);
}
