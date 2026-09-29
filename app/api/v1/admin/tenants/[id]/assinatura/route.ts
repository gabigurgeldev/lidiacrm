/**
 * /api/v1/admin/tenants/[id]/assinatura — a assinatura de uma organização vista
 * pelo painel da plataforma.
 *
 *   GET   — estado de acesso, datas, vínculo Asaas, últimas cobranças.
 *   PATCH — `{ isenta: boolean }`: liga/desliga a isenção de cobrança (a própria
 *           empresa, parceiros). Audita `billing.isencao_alterada`.
 *
 * Org SEMPRE do path (o gate de platform admin autoriza qualquer uma).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { exigirPlatformAdmin, lerCorpo } from "@/lib/admin/rota-da-plataforma";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { estadoDeAcesso } from "@/lib/billing/acesso";
import { configDeCobranca, invalidarAcesso, lerAssinatura } from "@/lib/billing/servico";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const admin = createAdminClient();
  const a = await lerAssinatura(admin, id);
  if (!a) return fail("not_found", "Organização não encontrada.", 404, { requestId });
  const cfg = configDeCobranca();
  const { data: cobrancas } = await admin
    .from("cobrancas")
    .select("asaas_payment_id, valor_centavos, metodo, status, vencimento, pago_em")
    .eq("organization_id", id)
    .order("vencimento", { ascending: false })
    .limit(6);

  return ok(
    {
      cobranca_ligada: cfg.ligada,
      estado: estadoDeAcesso(a, { ...cfg, ligada: true }),
      assinatura: a,
      cobrancas: cobrancas ?? [],
    },
    { requestId },
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const corpo = await lerCorpo(z.object({ isenta: z.boolean() }), req, requestId);
  if (!corpo.ok) return corpo.response;

  const admin = createAdminClient();
  const a = await lerAssinatura(admin, id);
  if (!a) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  const { error } = await admin
    .from("assinaturas")
    .update({ isenta: corpo.dados.isenta, updated_at: new Date().toISOString() })
    .eq("organization_id", id);
  if (error) return fail("internal_error", error.message, 500, { requestId });
  invalidarAcesso(id);

  void audit({
    action: "billing.isencao_alterada",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: id,
    resourceType: "assinatura",
    resourceId: id,
    requestId,
    metadata: { de: a.isenta, para: corpo.dados.isenta },
  });

  return ok({ organization_id: id, isenta: corpo.dados.isenta }, { requestId });
}
