/**
 * O checkout da assinatura — um único ponto de entrada para as quatro
 * situações que a tela de pagamento enfrenta:
 *
 *   1. primeira assinatura (em teste ou teste vencido);
 *   2. mensalidade em aberto (vencida ou do dia) — pagar ESSA cobrança;
 *   3. em dia, trocando o cartão ou mudando para PIX (vale para as próximas);
 *   4. assinatura cancelada — abre uma nova.
 *
 * ═══ Vencimento da primeira cobrança ═══
 * Quem assina DURANTE o teste não perde os dias que faltam: a primeira cobrança
 * vence no fim do teste. No PIX isso significa que pode pagar já e o acesso
 * conta a partir do fim do teste; no cartão, o Asaas só cobra no vencimento —
 * "cadastre o cartão, a cobrança vem quando o teste acabar".
 * Quem assina com o teste vencido paga com vencimento hoje.
 *
 * ⚠️ Cartão: `CartaoDigitado` atravessa esta função a caminho do Asaas e nunca
 * é gravado nem devolvido. Guardamos só os 4 últimos dígitos e a bandeira.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { STATUS_PAGOS } from "./acesso";
import * as asaas from "./asaas";
import {
  gravarCobranca,
  lerAssinatura,
  recalcularAssinatura,
  type Assinatura,
} from "./servico";

export type MetodoDePagamento = "PIX" | "CREDIT_CARD";

export interface PedidoDeCheckout {
  organizationId: string;
  organizationName: string;
  metodo: MetodoDePagamento;
  titular: asaas.Titular;
  cartao?: asaas.CartaoDigitado;
  ip: string | null;
}

export type ResultadoDoCheckout =
  | {
      tipo: "pix";
      pagamentoId: string;
      valorCentavos: number;
      vencimento: string | null;
      qrBase64: string;
      copiaECola: string;
      expiraEm: string | null;
    }
  | { tipo: "cartao_aprovado"; pagamentoId: string | null }
  | { tipo: "cartao_agendado"; vencimento: string | null }
  | { tipo: "metodo_atualizado" };

const ABERTOS = new Set(["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"]);

/** Data de hoje em São Paulo, `YYYY-MM-DD` (o Asaas trabalha com data local). */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

export function vencimentoDaPrimeira(a: Pick<Assinatura, "trial_termina_em">, agora: Date = new Date()): string {
  const hoje = hojeEmSaoPaulo(agora);
  if (a.trial_termina_em && new Date(a.trial_termina_em).getTime() > agora.getTime()) {
    const fim = hojeEmSaoPaulo(new Date(a.trial_termina_em));
    return fim > hoje ? fim : hoje;
  }
  return hoje;
}

function ultimos4(numero: string): string {
  return numero.replace(/\D/g, "").slice(-4);
}

async function sincronizar(admin: SupabaseClient, orgId: string, assinaturaId: string) {
  const pagamentos = await asaas.cobrancasDaAssinatura(assinaturaId);
  for (const p of pagamentos) await gravarCobranca(admin, orgId, p);
  await recalcularAssinatura(admin, orgId);
  return pagamentos;
}

function maisAntigoEmAberto(pagamentos: asaas.PagamentoAsaas[]): asaas.PagamentoAsaas | null {
  const abertos = pagamentos
    .filter((p) => ABERTOS.has(p.status))
    .sort((x, y) => (x.dueDate ?? "").localeCompare(y.dueDate ?? ""));
  return abertos[0] ?? null;
}

async function respostaPix(p: asaas.PagamentoAsaas): Promise<ResultadoDoCheckout> {
  const qr = await asaas.qrCodePix(p.id);
  return {
    tipo: "pix",
    pagamentoId: p.id,
    valorCentavos: asaas.centavos(p.value),
    vencimento: p.dueDate ?? null,
    qrBase64: qr.encodedImage,
    copiaECola: qr.payload,
    expiraEm: qr.expirationDate ?? null,
  };
}

export async function iniciarCheckout(
  admin: SupabaseClient,
  pedido: PedidoDeCheckout,
  agora: Date = new Date(),
): Promise<ResultadoDoCheckout> {
  const { organizationId: orgId } = pedido;
  if (pedido.metodo === "CREDIT_CARD" && !pedido.cartao) {
    throw new asaas.AsaasErro(422, "Informe os dados do cartão.");
  }

  const atual = await lerAssinatura(admin, orgId);
  if (!atual) throw new asaas.AsaasErro(404, "Organização não encontrada.");

  // 1. Cliente no Asaas (um por organização).
  let clienteId = atual.asaas_customer_id;
  if (clienteId) {
    await asaas.atualizarCliente(clienteId, pedido.titular);
  } else {
    clienteId = await asaas.criarCliente(pedido.titular, orgId);
    await admin
      .from("assinaturas")
      .update({ asaas_customer_id: clienteId, updated_at: agora.toISOString() })
      .eq("organization_id", orgId);
  }

  const precisaNova = !atual.asaas_subscription_id || atual.status === "cancelada";

  // 2. Primeira assinatura (ou nova depois de cancelar).
  if (precisaNova) {
    const vencimento = vencimentoDaPrimeira(atual, agora);
    const sub = await asaas.criarAssinatura({
      clienteId,
      metodo: pedido.metodo,
      valorCentavos: atual.valor_centavos,
      vencimento,
      organizationId: orgId,
      descricao: `Assinatura mensal — ${pedido.organizationName}`.slice(0, 500),
      titular: pedido.titular,
      ...(pedido.cartao ? { cartao: pedido.cartao } : {}),
      ip: pedido.ip,
    });
    await admin
      .from("assinaturas")
      .update({
        asaas_subscription_id: sub.id,
        metodo: pedido.metodo,
        status: atual.status === "cancelada" ? "inadimplente" : atual.status,
        cancelada_em: null,
        cartao_final: pedido.cartao ? ultimos4(pedido.cartao.numero) : null,
        cartao_bandeira: pedido.cartao ? (sub.creditCard?.creditCardBrand ?? null) : null,
        updated_at: agora.toISOString(),
      })
      .eq("organization_id", orgId);

    const pagamentos = await sincronizar(admin, orgId, sub.id);
    const primeiro = [...pagamentos].sort((x, y) => (x.dueDate ?? "").localeCompare(y.dueDate ?? ""))[0];

    if (pedido.metodo === "PIX") {
      if (!primeiro) throw new asaas.AsaasErro(502, "O Asaas não gerou a cobrança PIX.");
      return respostaPix(primeiro);
    }
    if (primeiro && STATUS_PAGOS.has(primeiro.status)) {
      return { tipo: "cartao_aprovado", pagamentoId: primeiro.id };
    }
    return { tipo: "cartao_agendado", vencimento: primeiro?.dueDate ?? vencimento };
  }

  // 3. Assinatura existente.
  const assinaturaId = atual.asaas_subscription_id!;
  if (atual.metodo !== pedido.metodo) {
    await asaas.mudarMetodoDaAssinatura(assinaturaId, pedido.metodo);
  }
  if (pedido.metodo === "CREDIT_CARD" && pedido.cartao) {
    const sub = await asaas.trocarCartao(assinaturaId, pedido.cartao, pedido.titular, pedido.ip);
    await admin
      .from("assinaturas")
      .update({
        metodo: "CREDIT_CARD",
        cartao_final: ultimos4(pedido.cartao.numero),
        cartao_bandeira: sub.creditCard?.creditCardBrand ?? null,
        updated_at: agora.toISOString(),
      })
      .eq("organization_id", orgId);
  } else if (atual.metodo !== pedido.metodo) {
    await admin
      .from("assinaturas")
      .update({ metodo: pedido.metodo, cartao_final: null, cartao_bandeira: null, updated_at: agora.toISOString() })
      .eq("organization_id", orgId);
  }

  const pagamentos = await sincronizar(admin, orgId, assinaturaId);
  const aberto = maisAntigoEmAberto(pagamentos);
  if (!aberto) return { tipo: "metodo_atualizado" };

  if (pedido.metodo === "PIX") return respostaPix(aberto);

  // Cartão com cobrança em aberto: paga ESSA agora — é o que libera quem está
  // bloqueado. Só quando a cobrança já venceu ou vence hoje: uma cobrança futura
  // o próprio Asaas debita no vencimento com o cartão que acabou de ser trocado.
  if ((aberto.dueDate ?? "") <= hojeEmSaoPaulo(agora)) {
    const pago = await asaas.pagarComCartao(aberto.id, pedido.cartao!, pedido.titular);
    await gravarCobranca(admin, orgId, pago);
    await recalcularAssinatura(admin, orgId);
    if (STATUS_PAGOS.has(pago.status)) return { tipo: "cartao_aprovado", pagamentoId: pago.id };
  }
  return { tipo: "cartao_agendado", vencimento: aberto.dueDate ?? null };
}

/** QR de uma cobrança PIX já existente — só se ela for DESTA organização. */
export async function qrDaCobranca(
  admin: SupabaseClient,
  organizationId: string,
  pagamentoId: string,
): Promise<ResultadoDoCheckout | null> {
  const { data } = await admin
    .from("cobrancas")
    .select("asaas_payment_id")
    .eq("organization_id", organizationId)
    .eq("asaas_payment_id", pagamentoId)
    .maybeSingle();
  if (!data) return null;
  const p = await asaas.obterCobranca(pagamentoId);
  if (!ABERTOS.has(p.status)) return null;
  return respostaPix(p);
}

export async function cancelar(admin: SupabaseClient, organizationId: string): Promise<void> {
  const atual = await lerAssinatura(admin, organizationId);
  if (!atual?.asaas_subscription_id) return;
  await asaas.cancelarAssinatura(atual.asaas_subscription_id);
  const agora = new Date().toISOString();
  await admin
    .from("assinaturas")
    .update({ status: "cancelada", cancelada_em: agora, updated_at: agora })
    .eq("organization_id", organizationId);
  await recalcularAssinatura(admin, organizationId);
}
