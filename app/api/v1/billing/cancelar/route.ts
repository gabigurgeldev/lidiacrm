/**
 * POST /api/v1/billing/cancelar — cancela a assinatura no Asaas. O acesso vale
 * até o fim do período já pago (`pago_ate`), sem tolerância depois — ver
 * `lib/billing/acesso.ts`. Pede `{ confirmar: true }` para um clique acidental
 * não cancelar nada.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { AsaasErro } from "@/lib/billing/asaas";
import { cancelar } from "@/lib/billing/checkout";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "billing", permitirSemAssinatura: true });
  if (!authz.ok) return authz.response;

  const body = z.object({ confirmar: z.literal(true) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return fail("validation_failed", "Confirme o cancelamento.", 422, { requestId });

  try {
    await cancelar(createAdminClient(), authz.org.orgId);
  } catch (e) {
    if (e instanceof AsaasErro) return fail("upstream_unavailable", e.message, 503, { requestId });
    throw e;
  }
  void audit({
    action: "billing.assinatura_cancelada",
    actorUserId: authz.user.id,
    organizationId: authz.org.orgId,
    resourceType: "assinatura",
    resourceId: authz.org.orgId,
    requestId,
    metadata: { por: "cliente" },
  });
  return ok({ cancelada: true }, { requestId });
}
