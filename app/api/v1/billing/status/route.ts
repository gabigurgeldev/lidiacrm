/**
 * GET /api/v1/billing/status — situação da assinatura da organização ativa.
 *
 * Qualquer membro lê (o atendente precisa saber por que o sistema parou);
 * só admin paga. Não barra por assinatura vencida — é a rota que a tela de
 * pagamento consulta a cada 3s enquanto espera o PIX cair.
 */
import { randomUUID } from "node:crypto";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { configDeCobranca, lerAssinatura } from "@/lib/billing/servico";
import { estadoDeAcesso } from "@/lib/billing/acesso";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "billing", permitirSemAssinatura: true });
  if (!authz.ok) return authz.response;

  const cfg = configDeCobranca();
  const admin = createAdminClient();
  const assinatura = cfg.ligada ? await lerAssinatura(admin, authz.org.orgId) : null;
  if (cfg.ligada && !assinatura) return fail("not_found", "Organização não encontrada.", 404, { requestId });

  // Lido SEM o cache de acesso: esta rota é a que confirma "o PIX caiu", e
  // o cache de 30s atrasaria a liberação exatamente no momento em que ela importa.
  const estado = assinatura
    ? estadoDeAcesso(assinatura, cfg)
    : { liberado: true, motivo: "cobranca_desligada" as const, ateQuando: null, diasRestantes: null, emAviso: false };

  const { data: cobrancas } = cfg.ligada
    ? await admin
        .from("cobrancas")
        .select("asaas_payment_id, valor_centavos, metodo, status, vencimento, pago_em, url_fatura")
        .eq("organization_id", authz.org.orgId)
        .order("vencimento", { ascending: false })
        .limit(24)
    : { data: [] };

  const lista = (cobrancas ?? []) as Array<{ status: string; vencimento: string | null }>;
  const emAberto = lista
    .filter((c) => ["PENDING", "OVERDUE"].includes(c.status))
    .sort((a, b) => (a.vencimento ?? "").localeCompare(b.vencimento ?? ""))[0] ?? null;

  return ok(
    {
      cobranca_ligada: cfg.ligada,
      pode_pagar: authz.org.role === "admin",
      estado,
      assinatura: assinatura
        ? {
            status: assinatura.status,
            isenta: assinatura.isenta,
            trial_termina_em: assinatura.trial_termina_em,
            pago_ate: assinatura.pago_ate,
            metodo: assinatura.metodo,
            cartao_final: assinatura.cartao_final,
            cartao_bandeira: assinatura.cartao_bandeira,
            valor_centavos: assinatura.valor_centavos,
            tem_assinatura_no_asaas: !!assinatura.asaas_subscription_id,
            cancelada_em: assinatura.cancelada_em,
          }
        : null,
      em_aberto: emAberto,
      cobrancas: cobrancas ?? [],
    },
    { requestId },
  );
}
