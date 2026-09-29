/**
 * GET /api/v1/billing/pix/[paymentId] — QR Code de uma cobrança PIX em aberto
 * DESTA organização (conferido em `cobrancas`, nunca confiando no id do path
 * sozinho). Serve para reabrir a tela de pagamento sem gerar outra cobrança.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { AsaasErro } from "@/lib/billing/asaas";
import { qrDaCobranca } from "@/lib/billing/checkout";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ paymentId: string }> }) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "billing", permitirSemAssinatura: true });
  if (!authz.ok) return authz.response;

  const { paymentId } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(paymentId)) {
    return fail("not_found", "Cobrança não encontrada.", 404, { requestId });
  }
  try {
    const r = await qrDaCobranca(createAdminClient(), authz.org.orgId, paymentId);
    if (!r) return fail("not_found", "Cobrança não encontrada ou já paga.", 404, { requestId });
    return ok(r, { requestId });
  } catch (e) {
    if (e instanceof AsaasErro) return fail("upstream_unavailable", e.message, 503, { requestId });
    throw e;
  }
}
