/**
 * POST /api/v1/admin/tenants/[id]/assinatura/estender-teste — dá mais dias de
 * teste grátis a uma organização.
 *
 * Corpo: `{ dias: 1..365 }`. Nova data = maior(agora, fim atual) + dias — a
 * regra mora em `lib/billing/estender-teste.ts`, a mesma que a tela usa para
 * mostrar a prévia. Audita `billing.trial_estendido` com de/para.
 *
 * ═══ O Asaas NÃO acompanha ═══
 *
 * Quando a organização já tem assinatura no Asaas, a primeira cobrança foi
 * agendada para o fim do teste ANTIGO (`vencimentoDaPrimeira`, em
 * `lib/billing/checkout.ts`) e esta rota não a move. A resposta traz
 * `aviso_asaas` e a tela diz isso em voz alta: estender o teste e deixar o
 * cartão ser cobrado antes do fim dele, calado, seria a pior combinação.
 *
 * Org SEMPRE do path (o gate de platform admin autoriza qualquer uma).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { exigirPlatformAdmin, lerCorpo } from "@/lib/admin/rota-da-plataforma";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import {
  MAX_DIAS_DE_EXTENSAO,
  novaDataDoTeste,
  podeEstender,
  statusDepoisDeEstender,
  type MotivoDeRecusa,
} from "@/lib/billing/estender-teste";
import { invalidarAcesso, lerAssinatura } from "@/lib/billing/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const corpoSchema = z.strictObject({
  dias: z.number().int().min(1).max(MAX_DIAS_DE_EXTENSAO),
});

const RECUSA: Record<MotivoDeRecusa, string> = {
  cancelada: "A assinatura desta organização foi cancelada — estender o teste não libera o acesso.",
  paga: "Esta organização já está paga; o teste não está em uso.",
  isenta: "Esta organização é isenta de cobrança e nunca é bloqueada.",
};

export async function POST(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return fail("not_found", "Organização não encontrada.", 404, { requestId });
  }

  const corpo = await lerCorpo(corpoSchema, req, requestId);
  if (!corpo.ok) return corpo.response;

  const admin = createAdminClient();
  const a = await lerAssinatura(admin, id);
  if (!a) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const agora = new Date();
  const decisao = podeEstender(a, agora);
  if (!decisao.pode) {
    return fail("trial_extension_not_allowed", RECUSA[decisao.motivo], 409, {
      requestId,
      details: { motivo: decisao.motivo },
    });
  }

  const para = novaDataDoTeste(a.trial_termina_em, agora, corpo.dados.dias).toISOString();
  const status = statusDepoisDeEstender(a);

  const { error } = await admin
    .from("assinaturas")
    .update({ trial_termina_em: para, status, updated_at: agora.toISOString() })
    .eq("organization_id", id);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  invalidarAcesso(id);

  void audit({
    action: "billing.trial_estendido",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "assinatura",
    resourceId: id,
    requestId,
    metadata: { de: a.trial_termina_em, para, dias: corpo.dados.dias, status_de: a.status, status_para: status },
  });

  return ok(
    {
      organization_id: id,
      trial_termina_em: para,
      status,
      aviso_asaas: a.asaas_subscription_id !== null,
    },
    { requestId },
  );
}
