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
  | "subscription.canceled";

export interface EventoParaBackoffice {
  event_id: string;
  type: TipoDeEvento;
  occurred_at: string;
  payment?: {
    external_id: string;
    amount_cents?: number;
    currency: "BRL";
    method: "pix" | "boleto" | "credit_card" | "manual";
    paid_at?: string;
  };
  subscription?: { external_id?: string; amount_cents?: number; status?: string };
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

/**
 * Os eventos que o estado ATUAL de uma cobrança implica. Estorno e chargeback
 * levam junto o `payment.succeeded` (mesmo `event_id`, então não duplica): se a
 * conciliação vir a cobrança já estornada, o Back Office precisa conhecer o
 * pagamento para estornar a comissão dele.
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
  return eventos;
}

interface ClienteDoBackoffice {
  external_id: string;
  name?: string;
  email?: string;
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
    // O e-mail do dono é o que o Back Office usa para barrar autoindicação.
    const { data } = await admin.auth.admin.getUserById(o.created_by).catch(() => ({ data: null }));
    const email = data?.user?.email;
    if (email) cliente.email = email;
  }
  return cliente;
}

/**
 * Põe os eventos na fila e agenda o envio para depois da resposta. Nunca lança:
 * falhar aqui não pode derrubar o webhook do Asaas nem o cadastro — a cobrança
 * já está gravada, e a conciliação horária passa por ela de novo.
 */
export async function emitirParaBackoffice(
  admin: Admin,
  organizationId: string,
  eventos: EventoParaBackoffice[],
): Promise<void> {
  if (!backofficeLigado() || eventos.length === 0) return;
  try {
    const ids = eventos.map((e) => e.event_id);
    const { data: existentes } = await admin.from("backoffice_saida").select("event_id").in("event_id", ids);
    const ja = new Set(((existentes ?? []) as Array<{ event_id: string }>).map((r) => r.event_id));
    const novos = eventos.filter((e) => !ja.has(e.event_id));
    if (novos.length === 0) return;

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
  } catch (e) {
    logger.warn("backoffice: evento não enfileirado", {
      organization_id: organizationId,
      erro: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Atalho do billing: a cobrança como está agora → eventos na fila. */
export async function emitirCobranca(admin: Admin, organizationId: string, p: PagamentoAsaas): Promise<void> {
  if (!backofficeLigado()) return;
  await emitirParaBackoffice(admin, organizationId, eventosDaCobranca(p));
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
