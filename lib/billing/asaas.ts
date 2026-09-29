/**
 * Cliente HTTP do Asaas (API v3) — só o que a assinatura usa.
 *
 * Doc: https://docs.asaas.com. Autenticação por header `access_token`; valores
 * em REAIS (float) no fio, e em centavos (inteiro) em todo o resto do sistema —
 * a conversão mora só aqui.
 *
 * ⚠️ DADO DE CARTÃO: número, validade e CVV passam por aqui a caminho do Asaas e
 * não vão a lugar nenhum mais — nem banco, nem log, nem audit, nem Sentry. Os
 * erros deste módulo carregam só a mensagem do Asaas, nunca o corpo enviado.
 */
import { z } from "zod";

import { env } from "@/lib/env";

export function urlBaseDoAsaas(ambiente: string = env.ASAAS_AMBIENTE): string {
  return ambiente.trim().toLowerCase() === "producao"
    ? "https://api.asaas.com/v3"
    : "https://api-sandbox.asaas.com/v3";
}

/**
 * A chave do Asaas começa com `$` (`$aact_prod_…`, `$aact_hmlg_…`), e tanto o
 * Next (`.env*`) quanto o `docker compose` (`--env-file`) leem `$…` como
 * variável: a chave vira vazio ou lixo, e a cobrança desliga sem erro nenhum.
 * Por isso o operador pode escrevê-la SEM o `$`, e ele é devolvido aqui.
 */
export function chaveDoAsaas(bruta: string = env.ASAAS_API_KEY): string {
  const chave = bruta.trim();
  return chave.startsWith("aact_") ? `$${chave}` : chave;
}

export function cobrancaLigada(): boolean {
  return chaveDoAsaas().length > 0;
}

export class AsaasErro extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly codigo: string | null = null,
  ) {
    super(message);
    this.name = "AsaasErro";
  }
}

const errosSchema = z.object({
  errors: z.array(z.object({ code: z.string().optional(), description: z.string() })).optional(),
});

async function chamar<T>(
  metodo: "GET" | "POST" | "PUT" | "DELETE",
  caminho: string,
  schema: z.ZodType<T>,
  corpo?: unknown,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  let res: Response;
  try {
    res = await fetch(`${urlBaseDoAsaas()}${caminho}`, {
      method: metodo,
      headers: {
        access_token: chaveDoAsaas(),
        "Content-Type": "application/json",
        "User-Agent": "crm-assinatura",
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    throw new AsaasErro(503, e instanceof Error && e.name === "AbortError" ? "Asaas não respondeu a tempo." : "Não consegui falar com o Asaas.");
  } finally {
    clearTimeout(timer);
  }

  const texto = await res.text();
  let json: unknown = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const e = errosSchema.safeParse(json);
    const primeiro = e.success ? e.data.errors?.[0] : undefined;
    throw new AsaasErro(res.status, primeiro?.description ?? `Asaas respondeu ${res.status}.`, primeiro?.code ?? null);
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new AsaasErro(502, "Resposta do Asaas em formato inesperado.");
  return r.data;
}

export const reais = (centavos: number) => Math.round(centavos) / 100;
export const centavos = (valorEmReais: number) => Math.round(valorEmReais * 100);

// ---------------------------------------------------------------------------
// Tipos do fio
// ---------------------------------------------------------------------------

export interface Titular {
  nome: string;
  cpfCnpj: string;
  email: string;
  telefone: string;
  cep: string;
  numero: string;
}

export interface CartaoDigitado {
  numero: string;
  nome: string;
  mes: string;
  ano: string;
  cvv: string;
}

const clienteSchema = z.object({ id: z.string() }).passthrough();

export const pagamentoSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    value: z.number(),
    dueDate: z.string().nullable().optional(),
    billingType: z.string().nullable().optional(),
    invoiceUrl: z.string().nullable().optional(),
    subscription: z.string().nullable().optional(),
    paymentDate: z.string().nullable().optional(),
    confirmedDate: z.string().nullable().optional(),
    externalReference: z.string().nullable().optional(),
  })
  .passthrough();
export type PagamentoAsaas = z.infer<typeof pagamentoSchema>;

const assinaturaSchema = z
  .object({
    id: z.string(),
    status: z.string().optional(),
    billingType: z.string().optional(),
    creditCard: z
      .object({
        creditCardNumber: z.string().nullable().optional(),
        creditCardBrand: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type AssinaturaAsaas = z.infer<typeof assinaturaSchema>;

const listaDePagamentos = z.object({ data: z.array(pagamentoSchema) }).passthrough();
const qrSchema = z.object({ encodedImage: z.string(), payload: z.string(), expirationDate: z.string().nullable().optional() });
export type QrPix = z.infer<typeof qrSchema>;

function soDigitos(s: string) {
  return s.replace(/\D/g, "");
}

function cartaoNoFio(c: CartaoDigitado) {
  const ano = soDigitos(c.ano);
  return {
    holderName: c.nome.trim(),
    number: soDigitos(c.numero),
    expiryMonth: soDigitos(c.mes).padStart(2, "0"),
    expiryYear: ano.length === 2 ? `20${ano}` : ano,
    ccv: soDigitos(c.cvv),
  };
}

function titularNoFio(t: Titular) {
  return {
    name: t.nome.trim(),
    email: t.email.trim(),
    cpfCnpj: soDigitos(t.cpfCnpj),
    postalCode: soDigitos(t.cep),
    addressNumber: t.numero.trim(),
    phone: soDigitos(t.telefone),
  };
}

// ---------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------

export async function criarCliente(t: Titular, organizationId: string): Promise<string> {
  const r = await chamar("POST", "/customers", clienteSchema, {
    name: t.nome.trim(),
    cpfCnpj: soDigitos(t.cpfCnpj),
    email: t.email.trim(),
    mobilePhone: soDigitos(t.telefone),
    postalCode: soDigitos(t.cep),
    addressNumber: t.numero.trim(),
    externalReference: organizationId,
  });
  return r.id;
}

export async function atualizarCliente(clienteId: string, t: Titular): Promise<void> {
  await chamar("PUT", `/customers/${encodeURIComponent(clienteId)}`, clienteSchema, {
    name: t.nome.trim(),
    cpfCnpj: soDigitos(t.cpfCnpj),
    email: t.email.trim(),
    mobilePhone: soDigitos(t.telefone),
    postalCode: soDigitos(t.cep),
    addressNumber: t.numero.trim(),
  });
}

export async function criarAssinatura(p: {
  clienteId: string;
  metodo: "PIX" | "CREDIT_CARD";
  valorCentavos: number;
  vencimento: string;
  organizationId: string;
  descricao: string;
  titular?: Titular;
  cartao?: CartaoDigitado;
  ip?: string | null;
}): Promise<AssinaturaAsaas> {
  return chamar("POST", "/subscriptions", assinaturaSchema, {
    customer: p.clienteId,
    billingType: p.metodo,
    value: reais(p.valorCentavos),
    nextDueDate: p.vencimento,
    cycle: "MONTHLY",
    description: p.descricao,
    externalReference: p.organizationId,
    ...(p.metodo === "CREDIT_CARD" && p.cartao && p.titular
      ? {
          creditCard: cartaoNoFio(p.cartao),
          creditCardHolderInfo: titularNoFio(p.titular),
          remoteIp: p.ip ?? undefined,
        }
      : {}),
  });
}

export async function mudarMetodoDaAssinatura(assinaturaId: string, metodo: "PIX" | "CREDIT_CARD"): Promise<void> {
  await chamar("PUT", `/subscriptions/${encodeURIComponent(assinaturaId)}`, assinaturaSchema, {
    billingType: metodo,
    updatePendingPayments: true,
  });
}

export async function trocarCartao(
  assinaturaId: string,
  cartao: CartaoDigitado,
  titular: Titular,
  ip: string | null,
): Promise<AssinaturaAsaas> {
  return chamar("PUT", `/subscriptions/${encodeURIComponent(assinaturaId)}/creditCard`, assinaturaSchema, {
    creditCard: cartaoNoFio(cartao),
    creditCardHolderInfo: titularNoFio(titular),
    remoteIp: ip ?? undefined,
  });
}

export async function cancelarAssinatura(assinaturaId: string): Promise<void> {
  await chamar("DELETE", `/subscriptions/${encodeURIComponent(assinaturaId)}`, z.unknown());
}

export async function cobrancasDaAssinatura(assinaturaId: string): Promise<PagamentoAsaas[]> {
  const r = await chamar("GET", `/subscriptions/${encodeURIComponent(assinaturaId)}/payments?limit=100`, listaDePagamentos);
  return r.data;
}

export async function obterCobranca(pagamentoId: string): Promise<PagamentoAsaas> {
  return chamar("GET", `/payments/${encodeURIComponent(pagamentoId)}`, pagamentoSchema);
}

export async function qrCodePix(pagamentoId: string): Promise<QrPix> {
  return chamar("GET", `/payments/${encodeURIComponent(pagamentoId)}/pixQrCode`, qrSchema);
}

export async function pagarComCartao(
  pagamentoId: string,
  cartao: CartaoDigitado,
  titular: Titular,
): Promise<PagamentoAsaas> {
  return chamar("POST", `/payments/${encodeURIComponent(pagamentoId)}/payWithCreditCard`, pagamentoSchema, {
    creditCard: cartaoNoFio(cartao),
    creditCardHolderInfo: titularNoFio(titular),
  });
}

export const _paraTeste = { cartaoNoFio, titularNoFio };
