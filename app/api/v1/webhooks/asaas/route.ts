/**
 * POST /api/v1/webhooks/asaas — eventos de cobrança e assinatura do Asaas.
 *
 * ═══ Autenticação ═══
 * O Asaas manda o "token de autenticação" configurado no painel no header
 * `asaas-access-token`. Comparado com `ASAAS_WEBHOOK_TOKEN` em tempo constante;
 * vazio no `.env` = tudo recusado (401), nunca "aceita qualquer coisa".
 *
 * ═══ Idempotência ═══
 * `eventos_asaas.evento_id` é UNIQUE. A reentrega do Asaas (e ela acontece:
 * qualquer resposta não-2xx é reenviada) bate no 23505 e volta 200 sem
 * reprocessar. E mesmo que reprocessasse, `pago_ate` é RECALCULADO das
 * cobranças (`recalcularAssinatura`), não somado — defesa em duas camadas.
 *
 * ═══ Qual organização ═══
 * Pela `subscription` do pagamento → `assinaturas.asaas_subscription_id`, que
 * nós gravamos no checkout. O `externalReference` vem do corpo do evento e só
 * serve de fallback quando a assinatura ainda não foi vinculada — e mesmo aí
 * exige que a org exista e que o cliente Asaas bata com o nosso.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { pagamentoSchema } from "@/lib/billing/asaas";
import { tokenConfere } from "@/lib/billing/webhook";
import { gravarCobranca, recalcularAssinatura } from "@/lib/billing/servico";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const eventoSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    payment: pagamentoSchema.extend({ customer: z.string().optional() }).optional(),
    subscription: z
      .object({ id: z.string(), customer: z.string().optional(), externalReference: z.string().nullable().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const EVENTOS_DE_PAGAMENTO = new Set([
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_REFUNDED",
  "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_DELETED",
  "PAYMENT_RESTORED",
  "PAYMENT_CHARGEBACK_REQUESTED",
  "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
]);

const AUDIT_POR_EVENTO: Record<string, Parameters<typeof audit>[0]["action"]> = {
  PAYMENT_CONFIRMED: "billing.pagamento_confirmado",
  PAYMENT_RECEIVED: "billing.pagamento_confirmado",
  PAYMENT_OVERDUE: "billing.pagamento_vencido",
  PAYMENT_REFUNDED: "billing.pagamento_estornado",
  PAYMENT_PARTIALLY_REFUNDED: "billing.pagamento_estornado",
  PAYMENT_CHARGEBACK_REQUESTED: "billing.pagamento_estornado",
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: "billing.pagamento_recusado",
  PAYMENT_CREDIT_CARD_CAPTURE_REFUSED: "billing.pagamento_recusado",
  SUBSCRIPTION_DELETED: "billing.assinatura_cancelada",
};

/** Status que a cobrança passa a ter quando o evento não traz o status final. */
function statusEfetivo(evento: string, status: string): string {
  if (evento.startsWith("PAYMENT_CHARGEBACK")) return "CHARGEBACK";
  if (evento === "PAYMENT_DELETED") return "DELETED";
  return status;
}

async function orgDoEvento(
  admin: ReturnType<typeof createAdminClient>,
  subscriptionId: string | null | undefined,
  externalReference: string | null | undefined,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (subscriptionId) {
    const { data } = await admin
      .from("assinaturas")
      .select("organization_id")
      .eq("asaas_subscription_id", subscriptionId)
      .maybeSingle();
    if (data) return (data as { organization_id: string }).organization_id;
  }
  if (externalReference && customerId && z.string().uuid().safeParse(externalReference).success) {
    const { data } = await admin
      .from("assinaturas")
      .select("organization_id")
      .eq("organization_id", externalReference)
      .eq("asaas_customer_id", customerId)
      .maybeSingle();
    if (data) return (data as { organization_id: string }).organization_id;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const requestId = randomUUID();

  if (!tokenConfere(req.headers.get("asaas-access-token"), env.ASAAS_WEBHOOK_TOKEN)) {
    void audit({
      action: "billing.webhook_recusado",
      requestId,
      metadata: { motivo: env.ASAAS_WEBHOOK_TOKEN ? "token_invalido" : "token_nao_configurado" },
    });
    return fail("unauthorized", "Token do webhook inválido.", 401, { requestId });
  }

  let bruto: unknown;
  try {
    bruto = await req.json();
  } catch {
    return fail("invalid_request", "Corpo inválido.", 400, { requestId });
  }
  const parsed = eventoSchema.safeParse(bruto);
  if (!parsed.success) {
    // 200 e não 400: o Asaas reenviaria para sempre um formato que não
    // entendemos. Fica registrado no audit e a conciliação cobre o que faltar.
    void audit({ action: "billing.webhook_recusado", requestId, metadata: { motivo: "formato" } });
    return ok({ ignorado: true }, { requestId });
  }
  const ev = parsed.data;
  const admin = createAdminClient();

  const pagamento = ev.payment;
  const subscriptionId = pagamento?.subscription ?? ev.subscription?.id ?? null;
  const organizationId = await orgDoEvento(
    admin,
    subscriptionId,
    pagamento?.externalReference ?? ev.subscription?.externalReference ?? null,
    pagamento?.customer ?? ev.subscription?.customer ?? null,
  );

  const { error: insErr } = await admin.from("eventos_asaas").insert({
    evento_id: ev.id,
    tipo: ev.event,
    organization_id: organizationId,
    payload: bruto as Record<string, unknown>,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      return ok({ duplicado: true }, { requestId });
    }
    // Não conseguimos registrar: 500 para o Asaas reenviar depois.
    return fail("internal_error", "Não consegui registrar o evento.", 500, { requestId });
  }

  if (!organizationId) {
    // Cobrança que não é de assinatura nossa (ou avulsa na mesma conta Asaas).
    return ok({ ignorado: true, motivo: "sem_organizacao" }, { requestId });
  }

  try {
    if (pagamento && EVENTOS_DE_PAGAMENTO.has(ev.event)) {
      await gravarCobranca(admin, organizationId, { ...pagamento, status: statusEfetivo(ev.event, pagamento.status) });
      await recalcularAssinatura(admin, organizationId);
    } else if (ev.event === "SUBSCRIPTION_DELETED" || ev.event === "SUBSCRIPTION_INACTIVATED") {
      await admin
        .from("assinaturas")
        .update({ status: "cancelada", cancelada_em: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId)
        .eq("asaas_subscription_id", subscriptionId);
      await recalcularAssinatura(admin, organizationId);
    }

    await admin
      .from("eventos_asaas")
      .update({ processado_em: new Date().toISOString() })
      .eq("evento_id", ev.id);
  } catch (e) {
    await admin
      .from("eventos_asaas")
      .update({ erro: e instanceof Error ? e.message.slice(0, 500) : "erro" })
      .eq("evento_id", ev.id);
    // O evento já está gravado (e uma reentrega bateria no 23505), então 200:
    // a conciliação horária reprocessa pelo Asaas.
    return ok({ registrado: true, processado: false }, { requestId });
  }

  const acao = AUDIT_POR_EVENTO[ev.event];
  if (acao) {
    void audit({
      action: acao,
      organizationId,
      resourceType: "assinatura",
      resourceId: organizationId,
      requestId,
      bypassedRls: true,
      metadata: {
        evento: ev.event,
        asaas_payment_id: pagamento?.id ?? null,
        valor: pagamento?.value ?? null,
        metodo: pagamento?.billingType ?? null,
      },
    });
  }

  return ok({ processado: true }, { requestId });
}
