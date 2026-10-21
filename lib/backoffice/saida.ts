/**
 * CRM → Back Office de afiliados: o caminho de volta.
 *
 * `lib/backoffice/rota.ts` é o Back Office chamando o CRM. Isto aqui é o
 * contrário, e cobre o que o cadastro sozinho não cobria:
 *
 *   1. **Indicação no cadastro.** `?ref=CODIGO` (o link `/r/CODIGO/gestalt-crm`
 *      do Back Office cai no `/signup` com ele) é validado em
 *      `GET /api/v1/affiliates/validate`; o desconto do afiliado vira o valor da
 *      mensalidade da organização, e toda renovação no Asaas já sai com ele.
 *   2. **Eventos.** Cadastro, cobrança paga, estorno, chargeback e cancelamento
 *      vão para `POST /api/v1/events`, que é de onde o Back Office tira receita e
 *      comissão.
 *   3. **Avisos de cobrança.** O Back Office é quem manda ao cliente, pelo
 *      WhatsApp, o aviso de fatura (pendente/vencida) e o de fim do teste
 *      grátis. O CRM manda o DADO: `invoice.updated` (estado da fatura),
 *      `subscription.updated` (status e fim do teste) e `customer.phone` (o
 *      WhatsApp do dono). O Asaas foi calado (`notificationDisabled`) para o
 *      cliente não receber o mesmo aviso duas vezes.
 *
 * ═══ Autenticação ═══
 * `Authorization: Bearer <BACKOFFICE_API_KEY>`, `X-Timestamp` (unix) e
 * `X-Signature: sha256=<HMAC-SHA256(API_KEY, "{timestamp}.{corpo}")>`.
 *
 * ═══ Entrega ═══
 * Todo evento entra em `backoffice_saida` (migration 0221) com `event_id`
 * estável — `crm_pay_<id>_succeeded`, por exemplo — e o UNIQUE engole a
 * repetição: o webhook e a conciliação horária passam pela mesma cobrança muitas
 * vezes. O envio acontece depois da resposta (`depoisDaResposta`); o que falhar o
 * cron `backoffice-saida` reenvia com espera crescente. 200 e 409 (o Back Office
 * já tinha) contam como entregue; outro 4xx é definitivo; 5xx, 429 e rede são
 * reenviados por até `JANELA_DE_REENVIO_MS`.
 *
 * Sem `BACKOFFICE_URL` + `BACKOFFICE_API_KEY` tudo aqui é no-op: instalação
 * self-host que não usa o Back Office não enfileira nada.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { STATUS_PAGOS } from "@/lib/billing/acesso";
import type { PagamentoAsaas } from "@/lib/billing/asaas";
import { depoisDaResposta } from "@/lib/channels/depois-da-resposta";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

import { assinar } from "./assinatura";

type Admin = SupabaseClient;

export const PRODUTO = "gestalt-crm";
export const JANELA_DE_REENVIO_MS = 7 * 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8_000;
const TIMEOUT_VALIDAR_MS = 4_000;

export function backofficeLigado(): boolean {
  return Boolean(env.BACKOFFICE_URL.trim() && env.BACKOFFICE_API_KEY.trim());
}

function urlBase(): string {
  return env.BACKOFFICE_URL.trim().replace(/\/+$/, "");
}

/** `JOAO10`, ou null se não for um código possível (mesma regra do Back Office). */
export function normalizarCodigo(bruto: string | null | undefined): string | null {
  const c = (bruto ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{3,20}$/.test(c) ? c : null;
}

/** Mensalidade com o desconto do afiliado, arredondada ao centavo. */
export function precoComDesconto(centavos: number, descontoBps: number | null): number {
  if (!descontoBps || descontoBps <= 0) return centavos;
  const bps = Math.min(descontoBps, 10_000);
  return Math.max(0, Math.round((centavos * (10_000 - bps)) / 10_000));
}

async function chamar(
  metodo: "GET" | "POST",
  caminho: string,
  corpo: string,
  timeoutMs: number,
): Promise<Response> {
  const chave = env.BACKOFFICE_API_KEY.trim();
  const ts = String(Math.floor(Date.now() / 1000));
  return fetch(`${urlBase()}${caminho}`, {
    method: metodo,
    headers: {
      authorization: `Bearer ${chave}`,
      "content-type": "application/json",
      "x-timestamp": ts,
      "x-signature": assinar(chave, ts, corpo),
    },
    body: metodo === "POST" ? corpo : undefined,
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
}

// ---------------------------------------------------------------------------
// Código de indicação
// ---------------------------------------------------------------------------

export type ValidacaoDoCodigo =
  | { estado: "valido"; codigo: string; descontoBps: number; nomeAfiliado: string | null }
  | { estado: "invalido"; codigo: string | null }
  /** Back Office desligado ou fora do ar: o código segue sem desconto. */
  | { estado: "indisponivel"; codigo: string };

const validacaoSchema = z.object({
  valid: z.boolean(),
  code: z.string().optional(),
  affiliate_name: z.string().nullable().optional(),
  discount_pct: z.number().min(0).max(100).optional(),
});

/** Nunca lança: qualquer falha do Back Office vira `indisponivel`. */
export async function validarCodigo(bruto: string | null | undefined): Promise<ValidacaoDoCodigo> {
  const codigo = normalizarCodigo(bruto);
  if (!codigo) return { estado: "invalido", codigo: null };
  if (!backofficeLigado()) return { estado: "indisponivel", codigo };
  try {
    const res = await chamar(
      "GET",
      `/api/v1/affiliates/validate?code=${encodeURIComponent(codigo)}`,
      "",
      TIMEOUT_VALIDAR_MS,
    );
    if (!res.ok) return { estado: "indisponivel", codigo };
    const r = validacaoSchema.safeParse(await res.json());
    if (!r.success) return { estado: "indisponivel", codigo };
    if (!r.data.valid) return { estado: "invalido", codigo };
    return {
      estado: "valido",
      codigo,
      descontoBps: Math.round((r.data.discount_pct ?? 0) * 100),
      nomeAfiliado: r.data.affiliate_name ?? null,
    };
  } catch (e) {
    logger.warn("backoffice: validação do código falhou", {
      erro: e instanceof Error ? e.message : String(e),
    });
    return { estado: "indisponivel", codigo };
  }
}

export interface Indicacao {
  affiliate_code: string;
  desconto_bps: number | null;
}

export async function lerIndicacao(admin: Admin, organizationId: string): Promise<Indicacao | null> {
  const { data } = await admin
    .from("backoffice_indicacoes")
    .select("affiliate_code, desconto_bps")
    .eq("organization_id", organizationId)
    .maybeSingle();
  return (data as Indicacao | null) ?? null;
}

/**
 * Grava a indicação de uma organização recém-criada e devolve o desconto a
 * aplicar na mensalidade. Revalida no Back Office: o código veio do cadastro,
 * que é entrada do navegador. Inválido = sem indicação; fora do ar = indicação
 * sem desconto (a comissão ainda chega, pelo evento).
 */
export async function registrarIndicacao(
  admin: Admin,
  organizationId: string,
  bruto: string | null | undefined,
): Promise<Indicacao | null> {
  if (!bruto || !backofficeLigado()) return null;
  const v = await validarCodigo(bruto);
  if (v.estado === "invalido") return null;
  const linha: Indicacao = {
    affiliate_code: v.codigo,
    desconto_bps: v.estado === "valido" ? v.descontoBps : null,
  };
  const { error } = await admin
    .from("backoffice_indicacoes")
    .upsert({ organization_id: organizationId, ...linha }, { onConflict: "organization_id", ignoreDuplicates: true });
  if (error) {
    logger.warn("backoffice: indicação não gravada", { organization_id: organizationId, erro: error.message });
    return null;
  }
  return (await lerIndicacao(admin, organizationId)) ?? linha;
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

export type TipoDeEvento =
  | "customer.created"
  | "payment.succeeded"
  | "payment.refunded"
  | "payment.chargeback"
  | "subscription.canceled"
  | "invoice.updated"
  | "subscription.updated";

type MetodoDoBackoffice = "pix" | "boleto" | "credit_card" | "manual";

/** Status de fatura no contrato do Back Office. */
export type StatusDaFatura = "pending" | "overdue" | "paid" | "canceled";

export interface EventoParaBackoffice {
  event_id: string;
  type: TipoDeEvento;
  occurred_at: string;
  payment?: {
    external_id: string;
    amount_cents?: number;
    currency: "BRL";
    method: MetodoDoBackoffice;
    paid_at?: string;
  };
  subscription?: {
    external_id?: string;
    amount_cents?: number;
    status?: string;
    /** `YYYY-MM-DD` (dia de São Paulo). O Back Office avisa o fim do teste por ela. */
    trial_ends_at?: string | null;
    subscribe_url?: string | null;
  };
  /**
   * A fatura como está agora. `external_id` = id da cobrança no Asaas — o MESMO
   * `payment.external_id` do `payment.succeeded` dela, que é como o Back Office
   * baixa a fatura que espelhou.
   */
  invoice?: {
    external_id: string;
    amount_cents: number;
    due_date: string;
    payment_url?: string | null;
    status: StatusDaFatura;
    method?: MetodoDoBackoffice;
  };
}

const METODOS: Record<string, "pix" | "boleto" | "credit_card"> = {
  PIX: "pix",
  BOLETO: "boleto",
  CREDIT_CARD: "credit_card",
};

const STATUS_DE_CHARGEBACK = new Set([
  "CHARGEBACK",
  "CHARGEBACK_REQUESTED",
  "CHARGEBACK_DISPUTE",
  "AWAITING_CHARGEBACK_REVERSAL",
]);

function hojeEmSaoPaulo(agora: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(agora);
}

/**
 * Data do Asaas (`YYYY-MM-DD`, dia de São Paulo) para instante ISO. Pagamento
 * de HOJE usa a hora real: o Back Office só comissiona pagamento feito depois
 * da atribuição, e meio-dia fixo poderia cair antes de um cadastro feito à
 * tarde. Dia passado vai para o meio da tarde de Brasília.
 */
export function instanteDoPagamento(data: string | null | undefined, agora: Date = new Date()): string {
  const dia = (data ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || dia >= hojeEmSaoPaulo(agora)) return agora.toISOString();
  return `${dia}T15:00:00.000Z`;
}

/** Só `https` vai para a mensagem que o Back Office manda ao cliente. */
function linkSeguro(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Status do Asaas → status da fatura no Back Office. O que não está aqui
 * (estorno, chargeback, análise de risco…) não vira `invoice.updated`: estorno e
 * chargeback já têm evento próprio.
 *
 * Não há status "recusada" no Asaas: cartão recusado na captura deixa a
 * cobrança `PENDING` — e ela continua, de fato, em aberto.
 */
function statusDaFatura(status: string): StatusDaFatura | null {
  if (status === "PENDING") return "pending";
  if (status === "OVERDUE") return "overdue";
  if (STATUS_PAGOS.has(status)) return "paid";
  if (status === "DELETED") return "canceled";
  return null;
}

/**
 * `invoice.updated` da cobrança, ou null quando o estado dela não interessa ao
 * Back Office ou falta o vencimento (obrigatório no contrato).
 *
 * O `event_id` de pendente e vencida leva o VENCIMENTO: o Asaas pode mudar a
 * data de uma cobrança em aberto, e a data nova é outro estado — tem de chegar.
 * Paga e cancelada são finais.
 *
 * Paga também vai, além do `payment.succeeded`: se um `pending` reenviado pela
 * fila chegar ao Back Office DEPOIS do pagamento, sem a fatura espelhada lá, ele
 * nasceria em aberto e o cliente seria cobrado de uma fatura paga. Com o `paid`
 * explícito, qualquer ordem de chegada termina em paga (o Back Office não
 * reabre fatura baixada).
 */
function eventoDaFatura(p: PagamentoAsaas, agora: Date): EventoParaBackoffice | null {
  const status = statusDaFatura(p.status);
  const vencimento = (p.dueDate ?? "").slice(0, 10);
  if (!status || !/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return null;
  const metodo = METODOS[p.billingType ?? ""];
  const sufixo = status === "pending" || status === "overdue" ? `${status}_${vencimento}` : status;
  return {
    event_id: `crm_pay_${p.id}_${sufixo}`,
    type: "invoice.updated",
    occurred_at: agora.toISOString(),
    invoice: {
      external_id: p.id,
      amount_cents: Math.round(p.value * 100),
      due_date: vencimento,
      payment_url: linkSeguro(p.invoiceUrl),
      status,
      ...(metodo ? { method: metodo } : {}),
    },
    ...(p.subscription ? { subscription: { external_id: p.subscription } } : {}),
  };
}

/**
 * Os eventos que o estado ATUAL de uma cobrança implica. Estorno e chargeback
 * levam junto o `payment.succeeded` (mesmo `event_id`, então não duplica): se a
 * conciliação vir a cobrança já estornada, o Back Office precisa conhecer o
 * pagamento para estornar a comissão dele.
 *
 * Pendente, vencida, paga e cancelada também viram `invoice.updated`: é por ele
 * que o Back Office manda o aviso de cobrança ao cliente pelo WhatsApp (o Asaas
 * não notifica mais — `notificationDisabled` em `lib/billing/asaas.ts`).
 */
export function eventosDaCobranca(p: PagamentoAsaas, agora: Date = new Date()): EventoParaBackoffice[] {
  const dataPaga = p.confirmedDate ?? p.paymentDate ?? null;
  const estornada = p.status === "REFUNDED";
  const contestada = STATUS_DE_CHARGEBACK.has(p.status);
  const paga = STATUS_PAGOS.has(p.status) || ((estornada || contestada) && Boolean(dataPaga));
  const pagamento = {
    external_id: p.id,
    currency: "BRL" as const,
    method: METODOS[p.billingType ?? ""] ?? ("manual" as const),
  };
  const assinatura = p.subscription ? { external_id: p.subscription } : undefined;
  const eventos: EventoParaBackoffice[] = [];

  if (paga) {
    const quando = instanteDoPagamento(dataPaga, agora);
    eventos.push({
      event_id: `crm_pay_${p.id}_succeeded`,
      type: "payment.succeeded",
      occurred_at: quando,
      payment: { ...pagamento, amount_cents: Math.round(p.value * 100), paid_at: quando },
      ...(assinatura ? { subscription: { ...assinatura, amount_cents: Math.round(p.value * 100), status: "active" } } : {}),
    });
  }
  if (estornada) {
    // Sem `amount_cents` = estorno total (contrato do Back Office).
    eventos.push({
      event_id: `crm_pay_${p.id}_refunded`,
      type: "payment.refunded",
      occurred_at: agora.toISOString(),
      payment: pagamento,
    });
  }
  if (contestada) {
    eventos.push({
      event_id: `crm_pay_${p.id}_chargeback`,
      type: "payment.chargeback",
      occurred_at: agora.toISOString(),
      payment: pagamento,
    });
  }
  const fatura = eventoDaFatura(p, agora);
  if (fatura) eventos.push(fatura);
  return eventos;
}

// ---------------------------------------------------------------------------
// Assinatura (teste grátis e status) → `subscription.updated`
// ---------------------------------------------------------------------------

/** O que `eventoDaAssinatura` lê de `assinaturas` (subconjunto de `Assinatura`). */
export interface AssinaturaParaBackoffice {
  status: string;
  isenta: boolean;
  trial_termina_em: string | null;
  pago_ate: string | null;
  cancelada_em?: string | null;
  valor_centavos: number;
  asaas_subscription_id: string | null;
}

/**
 * Status do CRM → status do Back Office. O Back Office só trata `trial` como
 * teste grátis e `canceled` como cancelamento; os outros dois ficam gravados
 * como estão.
 */
const STATUS_NO_BACKOFFICE: Record<string, string> = {
  trial: "trial",
  ativa: "active",
  inadimplente: "past_due",
  cancelada: "canceled",
};

function diaEmSaoPaulo(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? hojeEmSaoPaulo(d) : null;
}

/** Onde o cliente assina — a tela de pagamento. Só vai se for `https`. */
function urlDeAssinar(): string | null {
  return linkSeguro(`${env.NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, "")}/assinatura`);
}

/**
 * `subscription.updated` do estado atual da assinatura, ou null quando ela não
 * interessa ao Back Office (isenta nunca é cobrada; status desconhecido).
 *
 * `event_id` = organização + status + a data que define aquele estado: fim do
 * teste (estender o teste é estado novo, e o aviso tem de acompanhar a data
 * nova), `pago_ate` para ativa/inadimplente (cada renovação ou atraso é outro
 * estado) e o dia do cancelamento. Repetir o mesmo estado não reenvia nada.
 */
export function eventoDaAssinatura(
  organizationId: string,
  a: AssinaturaParaBackoffice,
  agora: Date = new Date(),
): EventoParaBackoffice | null {
  if (a.isenta) return null;
  const status = STATUS_NO_BACKOFFICE[a.status];
  if (!status) return null;
  const fimDoTeste = diaEmSaoPaulo(a.trial_termina_em);
  const marca =
    status === "trial"
      ? (fimDoTeste ?? "sem_data")
      : status === "canceled"
        ? (diaEmSaoPaulo(a.cancelada_em) ?? diaEmSaoPaulo(a.pago_ate) ?? "sem_data")
        : (diaEmSaoPaulo(a.pago_ate) ?? "nunca_pagou");
  return {
    event_id: `crm_org_${organizationId}_sub_${status}_${marca}`,
    type: "subscription.updated",
    occurred_at: agora.toISOString(),
    subscription: {
      status,
      // Fora do teste vai `null`: o Back Office limpa a data e não avisa fim de
      // teste de quem já saiu dele.
      trial_ends_at: status === "trial" ? fimDoTeste : null,
      subscribe_url: urlDeAssinar(),
      amount_cents: a.valor_centavos,
      ...(a.asaas_subscription_id ? { external_id: a.asaas_subscription_id } : {}),
    },
  };
}

interface ClienteDoBackoffice {
  external_id: string;
  name?: string;
  email?: string;
  /** WhatsApp do dono, só dígitos (com 55). É para onde o Back Office manda o aviso de cobrança. */
  phone?: string;
}

/** Só dígitos, 10 a 13 — o resto não é um WhatsApp possível e não vai. */
export function telefoneDoDono(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const digitos = bruto.replace(/\D/g, "");
  return digitos.length >= 10 && digitos.length <= 13 ? digitos : null;
}

/** Cliente no Back Office = a organização (mesmo id das criadas por `/backoffice/tenants`). */
async function clienteDaOrganizacao(admin: Admin, organizationId: string): Promise<ClienteDoBackoffice> {
  const cliente: ClienteDoBackoffice = { external_id: organizationId };
  const { data: org } = await admin
    .from("organizations")
    .select("display_name, created_by")
    .eq("id", organizationId)
    .maybeSingle();
  const o = org as { display_name: string | null; created_by: string | null } | null;
  if (o?.display_name) cliente.name = o.display_name.slice(0, 200);
  if (o?.created_by) {
    // O e-mail do dono é o que o Back Office usa para barrar autoindicação; o
    // WhatsApp (gravado pelo cadastro em `user_metadata.phone`) é para onde vai
    // o aviso de cobrança. Organização criada PELO Back Office não tem
    // `created_by` — lá o Back Office já tem o WhatsApp do dono.
    const { data } = await admin.auth.admin.getUserById(o.created_by).catch(() => ({ data: null }));
    const email = data?.user?.email;
    if (email) cliente.email = email;
    const telefone = telefoneDoDono(data?.user?.user_metadata?.phone);
    if (telefone) cliente.phone = telefone;
  }
  return cliente;
}

/**
 * Põe os eventos na fila e agenda o envio para depois da resposta. Nunca lança:
 * falhar aqui não pode derrubar o webhook do Asaas nem o cadastro — a cobrança
 * já está gravada, e a conciliação horária passa por ela de novo.
 *
 * Devolve quantos eventos NOVOS entraram na fila (0 quando já estavam lá ou
 * quando falhou) — é o "fez alguma coisa?" de quem precisa decidir se audita.
 */
export async function emitirParaBackoffice(
  admin: Admin,
  organizationId: string,
  eventos: EventoParaBackoffice[],
): Promise<number> {
  if (!backofficeLigado() || eventos.length === 0) return 0;
  try {
    const ids = eventos.map((e) => e.event_id);
    const { data: existentes } = await admin.from("backoffice_saida").select("event_id").in("event_id", ids);
    const ja = new Set(((existentes ?? []) as Array<{ event_id: string }>).map((r) => r.event_id));
    const novos = eventos.filter((e) => !ja.has(e.event_id));
    if (novos.length === 0) return 0;

    const [cliente, indicacao] = await Promise.all([
      clienteDaOrganizacao(admin, organizationId),
      lerIndicacao(admin, organizationId),
    ]);
    const linhas = novos.map((e) => ({
      event_id: e.event_id,
      organization_id: organizationId,
      tipo: e.type,
      payload: {
        ...e,
        product: PRODUTO,
        customer: cliente,
        ...(indicacao ? { affiliate_code: indicacao.affiliate_code } : {}),
      },
    }));
    const { error } = await admin
      .from("backoffice_saida")
      .upsert(linhas, { onConflict: "event_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);

    const enfileirados = linhas.map((l) => l.event_id);
    await depoisDaResposta("backoffice", async () => {
      await enviarPendentes(admin, { eventIds: enfileirados });
    });
    return enfileirados.length;
  } catch (e) {
    logger.warn("backoffice: evento não enfileirado", {
      organization_id: organizationId,
      erro: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}

/** Atalho do billing: a cobrança como está agora → eventos na fila. */
export async function emitirCobranca(admin: Admin, organizationId: string, p: PagamentoAsaas): Promise<void> {
  if (!backofficeLigado()) return;
  await emitirParaBackoffice(admin, organizationId, eventosDaCobranca(p));
}

/** Atalho do billing: a assinatura como está agora → `subscription.updated` na fila. */
export async function emitirAssinatura(
  admin: Admin,
  organizationId: string,
  a: AssinaturaParaBackoffice,
): Promise<number> {
  if (!backofficeLigado()) return 0;
  const evento = eventoDaAssinatura(organizationId, a);
  return evento ? emitirParaBackoffice(admin, organizationId, [evento]) : 0;
}

/** Teto da passada de conciliação. Teste dura dias, então isto é folga, não fila. */
const LOTE_DE_TESTES = 500;
const FATIA_DA_CONSULTA = 50;

/**
 * A passada da conciliação horária (`billing-conciliar`): todo teste grátis em
 * andamento chega ao Back Office com a sua data de fim. Cobre o que nasceu
 * antes de o aviso existir, e qualquer `subscription.updated` que não entrou na
 * fila no momento da mudança. O `event_id` leva a data de fim, então rodar de
 * novo não reenvia nada — e a pergunta "já está na fila?" é UMA consulta para o
 * lote inteiro, não uma por organização.
 *
 * Fatura em aberto não precisa de passada própria: a mesma conciliação já passa
 * cada cobrança das assinaturas que confere por `gravarCobranca`, que enfileira
 * o `invoice.updated`.
 *
 * Devolve quantos eventos entraram na fila agora. Nunca lança.
 */
export async function conciliarTestesNoBackoffice(admin: Admin, agora: Date = new Date()): Promise<number> {
  if (!backofficeLigado()) return 0;
  try {
    // Desde ontem: o Back Office também avisa NO DIA do fim.
    const desde = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from("assinaturas")
      .select("organization_id, status, isenta, trial_termina_em, pago_ate, cancelada_em, valor_centavos, asaas_subscription_id")
      .eq("status", "trial")
      .eq("isenta", false)
      .gte("trial_termina_em", desde)
      .order("trial_termina_em", { ascending: true })
      .limit(LOTE_DE_TESTES);
    if (error) throw new Error(error.message);

    const candidatos = ((data ?? []) as Array<AssinaturaParaBackoffice & { organization_id: string }>)
      .map((a) => ({ organizationId: a.organization_id, evento: eventoDaAssinatura(a.organization_id, a, agora) }))
      .filter((c): c is { organizationId: string; evento: EventoParaBackoffice } => c.evento !== null);
    if (candidatos.length === 0) return 0;

    // Em fatias: a lista vai na URL do PostgREST, e 500 ids não cabem nela.
    const ja = new Set<string>();
    const ids = candidatos.map((c) => c.evento.event_id);
    for (let i = 0; i < ids.length; i += FATIA_DA_CONSULTA) {
      const { data: existentes, error: erroFila } = await admin
        .from("backoffice_saida")
        .select("event_id")
        .in("event_id", ids.slice(i, i + FATIA_DA_CONSULTA));
      if (erroFila) throw new Error(erroFila.message);
      for (const r of (existentes ?? []) as Array<{ event_id: string }>) ja.add(r.event_id);
    }

    let enfileirados = 0;
    for (const c of candidatos) {
      if (ja.has(c.evento.event_id)) continue;
      enfileirados += await emitirParaBackoffice(admin, c.organizationId, [c.evento]);
    }
    return enfileirados;
  } catch (e) {
    logger.warn("backoffice: conciliação dos testes falhou", { erro: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

export async function emitirCancelamento(
  admin: Admin,
  organizationId: string,
  assinaturaAsaasId: string | null,
): Promise<void> {
  if (!backofficeLigado() || !assinaturaAsaasId) return;
  await emitirParaBackoffice(admin, organizationId, [
    {
      event_id: `crm_sub_${assinaturaAsaasId}_canceled`,
      type: "subscription.canceled",
      occurred_at: new Date().toISOString(),
      subscription: { external_id: assinaturaAsaasId, status: "canceled" },
    },
  ]);
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

export type Classificacao = "enviado" | "definitivo" | "reenviar";

export function classificar(status: number): Classificacao {
  if (status === 200 || status === 201 || status === 202 || status === 409) return "enviado";
  if (status === 408 || status === 429 || status >= 500) return "reenviar";
  return "definitivo";
}

/** 1, 2, 4, 8… minutos, no máximo 1 hora. */
export function esperaDaTentativa(tentativas: number): number {
  return Math.min(60, 2 ** Math.max(0, tentativas - 1)) * 60_000;
}

interface LinhaDaSaida {
  id: string;
  event_id: string;
  payload: Record<string, unknown>;
  tentativas: number;
  created_at: string;
}

export interface ResumoDoEnvio {
  enviados: number;
  reagendados: number;
  falharam: number;
}

export async function enviarPendentes(
  admin: Admin,
  opts: { eventIds?: string[]; limite?: number; agora?: Date } = {},
): Promise<ResumoDoEnvio> {
  const resumo: ResumoDoEnvio = { enviados: 0, reagendados: 0, falharam: 0 };
  if (!backofficeLigado()) return resumo;
  const agora = opts.agora ?? new Date();

  let q = admin
    .from("backoffice_saida")
    .select("id, event_id, payload, tentativas, created_at")
    .eq("status", "pendente")
    .lte("proxima_tentativa_em", agora.toISOString())
    .order("created_at", { ascending: true })
    .limit(opts.limite ?? 100);
  if (opts.eventIds) q = q.in("event_id", opts.eventIds);
  const { data, error } = await q;
  if (error) throw new Error(`backoffice_saida: ${error.message}`);

  for (const linha of (data ?? []) as LinhaDaSaida[]) {
    const tentativas = linha.tentativas + 1;
    let classe: Classificacao;
    let erro: string | null = null;
    try {
      const res = await chamar("POST", "/api/v1/events", JSON.stringify(linha.payload), TIMEOUT_MS);
      classe = classificar(res.status);
      if (classe !== "enviado") erro = `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`;
    } catch (e) {
      classe = "reenviar";
      erro = e instanceof Error ? e.message.slice(0, 300) : "erro de rede";
    }

    const vencido = agora.getTime() - new Date(linha.created_at).getTime() > JANELA_DE_REENVIO_MS;
    const mudanca =
      classe === "enviado"
        ? { status: "enviado", enviado_em: agora.toISOString(), ultimo_erro: null }
        : classe === "definitivo" || vencido
          ? { status: "falhou", ultimo_erro: erro }
          : {
              ultimo_erro: erro,
              proxima_tentativa_em: new Date(agora.getTime() + esperaDaTentativa(tentativas)).toISOString(),
            };
    // `status = pendente` no filtro: duas rodadas (depois da resposta + cron)
    // podem pegar a mesma linha; a segunda gravação não desfaz a primeira.
    await admin
      .from("backoffice_saida")
      .update({ ...mudanca, tentativas })
      .eq("id", linha.id)
      .eq("status", "pendente");

    if (classe === "enviado") resumo.enviados += 1;
    else if ("status" in mudanca) {
      resumo.falharam += 1;
      logger.warn("backoffice: evento recusado em definitivo", { event_id: linha.event_id, erro });
    } else resumo.reagendados += 1;
  }
  return resumo;
}
