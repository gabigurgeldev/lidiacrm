/**
 * Assinatura da organização — o lado com I/O (banco + Asaas).
 *
 * Quem pergunta "pode usar?" chama `acessoDaOrganizacao` / `organizacaoPodeOperar`.
 * Quem escreve é só isto aqui, com service role: o cliente não tem grant de
 * escrita nas tabelas (migration 0217), senão ele mesmo esticaria `pago_ate`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

import {
  estadoDeAcesso,
  pagoAteDasCobrancas,
  STATUS_PAGOS,
  type EstadoDeAcesso,
  type LinhaDeAssinatura,
} from "./acesso";
import { centavos, cobrancaLigada, type PagamentoAsaas } from "./asaas";

type Admin = ReturnType<typeof createAdminClient>;

export interface Assinatura extends LinhaDeAssinatura {
  organization_id: string;
  metodo: "PIX" | "CREDIT_CARD" | null;
  asaas_customer_id: string | null;
  asaas_subscription_id: string | null;
  cartao_final: string | null;
  cartao_bandeira: string | null;
  valor_centavos: number;
  cancelada_em: string | null;
}

const COLUNAS =
  "organization_id, status, isenta, trial_termina_em, pago_ate, metodo, asaas_customer_id, asaas_subscription_id, cartao_final, cartao_bandeira, valor_centavos, cancelada_em";

const DIA_MS = 24 * 60 * 60 * 1000;

export function configDeCobranca() {
  return { ligada: cobrancaLigada(), diasTolerancia: env.COBRANCA_DIAS_TOLERANCIA };
}

// ---------------------------------------------------------------------------
// Cache de acesso (por processo)
// ---------------------------------------------------------------------------

const TTL_MS = 30_000;
const cache = new Map<string, { ate: number; valor: { estado: EstadoDeAcesso; assinatura: Assinatura } }>();

/**
 * O webhook de pagamento chama isto: "pagou libera na hora" não pode esperar o
 * cache expirar. Vale para o processo que recebeu o webhook; outro processo
 * (worker) enxerga em até `TTL_MS`.
 */
export function invalidarAcesso(organizationId: string): void {
  cache.delete(organizationId);
}

export function _limparCacheParaTeste(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export async function lerAssinatura(admin: Admin, organizationId: string): Promise<Assinatura | null> {
  const { data, error } = await admin
    .from("assinaturas")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(`assinaturas: ${error.message}`);
  if (data) return data as Assinatura;

  // Org SEM linha: algum caminho de criação esqueceu de abrir a assinatura (ou a
  // gravação falhou depois de a org nascer). Tratada como TRIAL contado do
  // `created_at` — nunca como isenta: isenção é decisão, não acidente.
  const { data: org } = await admin
    .from("organizations")
    .select("created_at")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return null;
  const inicio = new Date((org as { created_at: string }).created_at).getTime();
  const linha = {
    organization_id: organizationId,
    status: "trial",
    isenta: false,
    trial_termina_em: new Date(inicio + env.COBRANCA_DIAS_TRIAL * DIA_MS).toISOString(),
    valor_centavos: env.COBRANCA_VALOR_CENTAVOS,
  };
  await admin.from("assinaturas").upsert(linha, { onConflict: "organization_id", ignoreDuplicates: true });
  const { data: criada } = await admin
    .from("assinaturas")
    .select(COLUNAS)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (criada as Assinatura | null) ?? null;
}

export async function acessoDaOrganizacao(
  organizationId: string,
): Promise<{ estado: EstadoDeAcesso; assinatura: Assinatura | null }> {
  const cfg = configDeCobranca();
  if (!cfg.ligada) {
    return {
      estado: { liberado: true, motivo: "cobranca_desligada", ateQuando: null, diasRestantes: null, emAviso: false },
      assinatura: null,
    };
  }
  const agora = Date.now();
  const hit = cache.get(organizationId);
  if (hit && hit.ate > agora) return hit.valor;

  const assinatura = await lerAssinatura(createAdminClient(), organizationId);
  if (!assinatura) {
    // Org inexistente: nada a liberar nem a bloquear aqui — quem chamou já
    // resolve "org não existe" do seu jeito.
    return {
      estado: { liberado: true, motivo: "cobranca_desligada", ateQuando: null, diasRestantes: null, emAviso: false },
      assinatura: null,
    };
  }
  const valor = { estado: estadoDeAcesso(assinatura, cfg), assinatura };
  cache.set(organizationId, { ate: agora + TTL_MS, valor });
  return valor;
}

/**
 * Para MOTORES de automação (agente, disparo, fluxo, follow-up): a org pode
 * operar agora?
 *
 * ⚠️ FALHA ABERTA em erro de leitura: um soluço do banco não pode calar a IA de
 * quem está pagando. O custo é que, durante o soluço, quem está bloqueado passa
 * — e o soluço é raro e curto, o bloqueio indevido de um cliente pagante não.
 */
export async function organizacaoPodeOperar(organizationId: string): Promise<boolean> {
  try {
    return (await acessoDaOrganizacao(organizationId)).estado.liberado;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Abre a assinatura de uma org recém-criada. Idempotente. */
export async function abrirAssinatura(
  admin: Admin,
  organizationId: string,
  opts: { isenta?: boolean } = {},
): Promise<void> {
  const agora = Date.now();
  await admin.from("assinaturas").upsert(
    {
      organization_id: organizationId,
      status: opts.isenta ? "ativa" : "trial",
      isenta: opts.isenta ?? false,
      trial_termina_em: opts.isenta ? null : new Date(agora + env.COBRANCA_DIAS_TRIAL * DIA_MS).toISOString(),
      valor_centavos: env.COBRANCA_VALOR_CENTAVOS,
    },
    { onConflict: "organization_id", ignoreDuplicates: true },
  );
}

/** Grava/atualiza uma cobrança vinda do Asaas. */
export async function gravarCobranca(admin: Admin, organizationId: string, p: PagamentoAsaas): Promise<void> {
  const pagoEm = STATUS_PAGOS.has(p.status)
    ? (p.confirmedDate ?? p.paymentDate ?? new Date().toISOString().slice(0, 10))
    : null;
  const { error } = await admin.from("cobrancas").upsert(
    {
      organization_id: organizationId,
      asaas_payment_id: p.id,
      asaas_subscription_id: p.subscription ?? null,
      valor_centavos: centavos(p.value),
      metodo: p.billingType ?? null,
      status: p.status,
      vencimento: p.dueDate ?? null,
      pago_em: pagoEm ? new Date(pagoEm).toISOString() : null,
      url_fatura: p.invoiceUrl ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "asaas_payment_id" },
  );
  if (error) throw new Error(`cobrancas: ${error.message}`);
}

/**
 * Recalcula `pago_ate` e `status` da assinatura a partir de TODAS as cobranças
 * gravadas. É o único jeito de mexer em `pago_ate` — idempotente por construção
 * (ver `pagoAteDasCobrancas`).
 */
export async function recalcularAssinatura(admin: Admin, organizationId: string): Promise<Assinatura | null> {
  const { data: cobrancas, error } = await admin
    .from("cobrancas")
    .select("status, vencimento")
    .eq("organization_id", organizationId);
  if (error) throw new Error(`cobrancas: ${error.message}`);

  const atual = await lerAssinatura(admin, organizationId);
  if (!atual) return null;

  const lista = (cobrancas ?? []) as Array<{ status: string; vencimento: string | null }>;
  const pagoAte = pagoAteDasCobrancas(lista);
  const vencida = lista.some((c) => c.status === "OVERDUE");
  const agora = new Date().toISOString();

  let status = atual.status;
  if (status !== "cancelada") {
    if (pagoAte && pagoAte > agora) status = "ativa";
    else if (vencida || pagoAte) status = "inadimplente";
    else status = "trial";
  }

  await admin
    .from("assinaturas")
    .update({ pago_ate: pagoAte, status, updated_at: agora })
    .eq("organization_id", organizationId);
  invalidarAcesso(organizationId);
  return { ...atual, pago_ate: pagoAte, status };
}
