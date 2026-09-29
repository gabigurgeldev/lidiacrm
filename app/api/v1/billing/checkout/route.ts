/**
 * POST /api/v1/billing/checkout — assinar, pagar a cobrança em aberto, trocar
 * o cartão ou mudar para PIX. Toda a lógica está em `lib/billing/checkout.ts`.
 *
 * Só admin da organização. Não barra por assinatura vencida (senão quem está
 * bloqueado não consegue pagar). Rate limit por IP e por organização: rota que
 * recebe número de cartão é alvo de "teste de cartão roubado".
 *
 * ⚠️ O corpo tem dado de cartão. Ele não entra em audit, log nem resposta —
 * nem quando a validação falha (a resposta de 422 leva só os NOMES dos campos).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { authRateLimited } from "@/lib/auth/rate-limit";
import { AsaasErro, cobrancaLigada } from "@/lib/billing/asaas";
import { iniciarCheckout } from "@/lib/billing/checkout";
import { invalidarAcesso } from "@/lib/billing/servico";
import { checkoutSchema } from "@/lib/billing/validacao";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "billing", permitirSemAssinatura: true });
  if (!authz.ok) return authz.response;

  if (!cobrancaLigada()) {
    return fail("state_conflict", "A cobrança não está ativa nesta instalação.", 409, { requestId });
  }

  if (await authRateLimited("billing_checkout", authz.org.orgId, { ip: 20, id: 10, windowSec: 3600 })) {
    return fail("rate_limited", "Muitas tentativas de pagamento. Aguarde alguns minutos.", 429, { requestId });
  }

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("invalid_request", "Corpo inválido.", 400, { requestId });
  }
  const parsed = checkoutSchema.safeParse(bruto);
  if (!parsed.success) {
    // Só caminho + mensagem: `flatten()` devolveria os VALORES recusados em
    // alguns casos, e aqui um deles pode ser o número do cartão.
    const campos = parsed.error.issues.map((i) => ({ campo: i.path.join("."), mensagem: i.message }));
    return fail("validation_failed", campos[0]?.mensagem ?? "Dados inválidos.", 422, {
      requestId,
      details: { campos },
    });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const admin = createAdminClient();

  try {
    const r = await iniciarCheckout(admin, {
      organizationId: authz.org.orgId,
      organizationName: authz.org.name,
      metodo: parsed.data.metodo,
      titular: parsed.data.titular,
      ...(parsed.data.cartao ? { cartao: parsed.data.cartao } : {}),
      ip,
    });
    invalidarAcesso(authz.org.orgId);

    void audit({
      action: r.tipo === "metodo_atualizado"
        ? (parsed.data.metodo === "CREDIT_CARD" ? "billing.cartao_trocado" : "billing.metodo_trocado")
        : "billing.checkout_iniciado",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "assinatura",
      resourceId: authz.org.orgId,
      requestId,
      metadata: {
        metodo: parsed.data.metodo,
        resultado: r.tipo,
        ...(parsed.data.cartao ? { cartao_final: parsed.data.cartao.numero.replace(/\D/g, "").slice(-4) } : {}),
      },
    });

    return ok(r, { requestId });
  } catch (e) {
    if (e instanceof AsaasErro) {
      const recusado = parsed.data.metodo === "CREDIT_CARD" && e.status >= 400 && e.status < 500;
      if (recusado) {
        void audit({
          action: "billing.pagamento_recusado",
          actorUserId: authz.user.id,
          organizationId: authz.org.orgId,
          resourceType: "assinatura",
          resourceId: authz.org.orgId,
          requestId,
          metadata: { motivo_asaas: e.message.slice(0, 200), codigo: e.codigo },
        });
        return fail("payment_declined", e.message, 402, { requestId });
      }
      return fail(
        e.status >= 500 ? "upstream_unavailable" : "validation_failed",
        e.message,
        e.status >= 500 ? 503 : 422,
        { requestId },
      );
    }
    throw e;
  }
}
