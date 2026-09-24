/**
 * Tenants criados pelo Back Office de afiliados da Gestalt (contrato em
 * `docs/integracoes/backoffice.md`). Tenant = organização; o dono recebe um
 * convite `admin` (o mesmo link de `/team/accept-invite`, que serve a quem já
 * tem conta e a quem ainda não tem).
 *
 * Service role: a organização vem SEMPRE do caminho (`/backoffice/tenants/{id}`)
 * e só vale se tiver linha em `backoffice_tenants` — o Back Office não alcança
 * organização que ele não criou.
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { audit } from "@/lib/audit";
import { signInviteToken } from "@/lib/auth/invite-token";
import { marcaDaSaida } from "@/lib/branding/saida";
import { sendEmail } from "@/lib/email/resend";
import { buildInviteEmail } from "@/lib/email/templates/invite";
import { logger } from "@/lib/logger";

/** Convite do dono vale 7 dias: o link também vai por WhatsApp, e 24h é pouco para isso. */
export const CONVITE_DONO_SEGUNDOS = 7 * 24 * 60 * 60;

export const pedidoDeTenantSchema = z.object({
  request_id: z.string().uuid(),
  company_name: z.string().trim().min(2).max(200),
  document: z.string().regex(/^(\d{11}|\d{14})$/, "CPF (11) ou CNPJ (14), só dígitos"),
  owner: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().toLowerCase().email(),
    whatsapp: z.string().max(20).optional(),
  }),
  plan: z.string().trim().min(1).max(100),
  amount_cents: z.number().int().min(0),
  affiliate_code: z.string().trim().max(40).nullish(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const alteracaoDePlanoSchema = z.object({
  plan: z.string().trim().min(1).max(100),
  amount_cents: z.number().int().min(0),
});

export type PedidoDeTenant = z.infer<typeof pedidoDeTenantSchema>;
export type Resposta = { status: number; body: unknown };

const MOTIVO_SUSPENSAO = "Suspenso pelo Back Office de afiliados (Gestalt)";

function slugDe(nome: string): string {
  const base = nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/, "");
  // Sufixo aleatório: dois clientes com o mesmo nome não disputam o slug (unique).
  return `${base || "empresa"}-${randomBytes(3).toString("hex")}`;
}

function linkDoConvite(baseUrl: string, organizationId: string, email: string) {
  const exp = Math.floor(Date.now() / 1000) + CONVITE_DONO_SEGUNDOS;
  const token = signInviteToken({
    invite_id: randomUUID(),
    email,
    organization_id: organizationId,
    role: "admin",
    exp,
  });
  return {
    url: `${baseUrl.replace(/\/$/, "")}/team/accept-invite/${token}`,
    expiresAt: new Date(exp * 1000),
  };
}

export async function criarTenant(
  admin: SupabaseClient,
  pedido: PedidoDeTenant,
  baseUrl: string,
): Promise<Resposta> {
  // Pedido repetido (mesmo request_id): devolve a MESMA organização, com link novo e sem novo e-mail.
  const { data: existente, error: erroBusca } = await admin
    .from("backoffice_tenants")
    .select("organization_id, owner_email")
    .eq("request_id", pedido.request_id)
    .maybeSingle();
  if (erroBusca) return { status: 500, body: { error: "lookup_failed" } };
  if (existente) {
    const convite = linkDoConvite(baseUrl, existente.organization_id, existente.owner_email);
    return {
      status: 200,
      body: { external_tenant_id: existente.organization_id, access_url: convite.url },
    };
  }

  const { data: org, error: erroOrg } = await admin
    .from("organizations")
    .insert({
      display_name: pedido.company_name.slice(0, 120),
      legal_name: pedido.company_name,
      slug: slugDe(pedido.company_name),
      cnpj: pedido.document.length === 14 ? pedido.document : null,
      status: "active",
      settings: { plan: "standard" },
    })
    .select("id, display_name")
    .single();
  if (erroOrg || !org) {
    logger.error("backoffice.tenant.org_falhou", {
      requestId: pedido.request_id,
      motivo: erroOrg?.message,
    });
    return { status: 500, body: { error: "organization_insert_failed" } };
  }

  const { error: erroVinculo } = await admin.from("backoffice_tenants").insert({
    organization_id: org.id,
    request_id: pedido.request_id,
    affiliate_code: pedido.affiliate_code ?? null,
    plan_name: pedido.plan,
    plan_amount_cents: pedido.amount_cents,
    owner_email: pedido.owner.email,
  });
  if (erroVinculo) {
    // Outra chamada com o mesmo request_id venceu a corrida: desfaz esta empresa
    // (acabou de nascer, vazia) e responde com a que ficou.
    await admin.from("organizations").delete().eq("id", org.id);
    if (erroVinculo.code === "23505") return criarTenant(admin, pedido, baseUrl);
    logger.error("backoffice.tenant.vinculo_falhou", {
      requestId: pedido.request_id,
      motivo: erroVinculo.message,
    });
    return { status: 500, body: { error: "link_insert_failed" } };
  }

  const convite = linkDoConvite(baseUrl, org.id, pedido.owner.email);
  const marca = await marcaDaSaida(org.id);
  const email = buildInviteEmail({
    inviterName: "Gestalt",
    orgName: org.display_name,
    acceptUrl: convite.url,
    role: "admin",
    expiresAt: convite.expiresAt,
    marca,
  });
  const envio = await sendEmail({
    to: pedido.owner.email,
    ...email,
    fromName: marca.nome,
    tags: [
      { name: "kind", value: "backoffice_owner_invite" },
      { name: "org", value: org.id },
    ],
  });

  void audit({
    action: "tenant.created_by_backoffice",
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    bypassedRls: true,
    requestId: pedido.request_id,
    metadata: {
      affiliate_code: pedido.affiliate_code ?? null,
      plan: pedido.plan,
      amount_cents: pedido.amount_cents,
      email_dispatched: envio.ok,
    },
  });

  return { status: 201, body: { external_tenant_id: org.id, access_url: convite.url } };
}

/** Organização só é alcançável se foi o Back Office que a criou. */
async function orgDoBackoffice(admin: SupabaseClient, organizationId: string) {
  if (!z.string().uuid().safeParse(organizationId).success) return null;
  const { data } = await admin
    .from("backoffice_tenants")
    .select("organization_id, organizations(status)")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return null;
  const org = data.organizations as { status: string } | { status: string }[] | null;
  const status = Array.isArray(org) ? org[0]?.status : org?.status;
  return status ? { status } : null;
}

export async function alternarSuspensao(
  admin: SupabaseClient,
  organizationId: string,
  suspender: boolean,
): Promise<Resposta> {
  const org = await orgDoBackoffice(admin, organizationId);
  if (!org) return { status: 404, body: { error: "tenant_not_found" } };
  const alvo = suspender ? "suspended" : "active";
  // Repetir o pedido não é erro: o Back Office trata 2xx como feito.
  if (org.status === alvo) return { status: 200, body: { ok: true, status: alvo } };
  if (!suspender && org.status !== "suspended")
    return { status: 409, body: { error: "not_suspended" } };

  const agora = new Date().toISOString();
  const { error } = await admin
    .from("organizations")
    .update(
      suspender
        ? {
            status: "suspended",
            suspended_at: agora,
            suspended_reason: MOTIVO_SUSPENSAO,
            suspended_by: null,
            updated_at: agora,
          }
        : {
            status: "active",
            suspended_at: null,
            suspended_reason: null,
            suspended_by: null,
            updated_at: agora,
          },
    )
    .eq("id", organizationId);
  if (error) return { status: 500, body: { error: "update_failed" } };
  await admin
    .from("backoffice_tenants")
    .update({ updated_at: agora })
    .eq("organization_id", organizationId);

  const evento = suspender ? "tenant.suspended" : "tenant.reactivated";
  void audit({
    action: evento,
    organizationId,
    resourceType: "organization",
    resourceId: organizationId,
    bypassedRls: true,
    metadata: { tenant_id: organizationId, origem: "backoffice", reason: MOTIVO_SUSPENSAO },
  });
  // Mesmo evento de domínio que o painel de plataforma emite ao suspender/reativar.
  // `await` de propósito: o builder do supabase-js é preguiçoso e só executa quando
  // alguém chama `.then()` — um `void admin.from(...).insert()` nunca chega ao banco.
  await admin.from("event_log").insert({
    organization_id: organizationId,
    entity_kind: "organization",
    entity_id: organizationId,
    event_type: evento,
    payload: { tenant_id: organizationId, origem: "backoffice" },
  });
  return { status: 200, body: { ok: true, status: alvo } };
}

export async function alterarPlano(
  admin: SupabaseClient,
  organizationId: string,
  plano: z.infer<typeof alteracaoDePlanoSchema>,
): Promise<Resposta> {
  const org = await orgDoBackoffice(admin, organizationId);
  if (!org) return { status: 404, body: { error: "tenant_not_found" } };
  const { error } = await admin
    .from("backoffice_tenants")
    .update({
      plan_name: plano.plan,
      plan_amount_cents: plano.amount_cents,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", organizationId);
  if (error) return { status: 500, body: { error: "update_failed" } };
  void audit({
    action: "tenant.plan_changed_by_backoffice",
    organizationId,
    resourceType: "organization",
    resourceId: organizationId,
    bypassedRls: true,
    metadata: { plan: plano.plan, amount_cents: plano.amount_cents },
  });
  return { status: 200, body: { ok: true, plan: plano.plan, amount_cents: plano.amount_cents } };
}

type LinhaVinculo = {
  organization_id: string;
  affiliate_code: string | null;
  plan_amount_cents: number | null;
  updated_at: string;
  organizations: { status: string } | { status: string }[] | null;
};

const statusDe = (l: LinhaVinculo) =>
  (Array.isArray(l.organizations) ? l.organizations[0]?.status : l.organizations?.status) ??
  "unknown";

export async function estatisticas(admin: SupabaseClient): Promise<Resposta> {
  const { data, error } = await admin
    .from("backoffice_tenants")
    .select("organization_id, plan_amount_cents, organizations(status)");
  if (error) return { status: 500, body: { error: "query_failed" } };
  const linhas = (data ?? []) as unknown as LinhaVinculo[];
  const ativas = linhas.filter((l) => statusDe(l) === "active");
  return {
    status: 200,
    body: {
      users_total: linhas.length,
      users_active: ativas.length,
      customers_paying: ativas.filter((l) => (l.plan_amount_cents ?? 0) > 0).length,
    },
  };
}

export const PAGINA_ASSINATURAS = 200;

/**
 * Conciliação: tenants alterados desde `updated_since`, em ordem de alteração.
 * `next_cursor` é o `updated_at` do último item — usado como novo `updated_since`,
 * o item da fronteira pode vir de novo (a conciliação é idempotente).
 */
export async function assinaturas(
  admin: SupabaseClient,
  updatedSince: string | null,
): Promise<Resposta> {
  let query = admin
    .from("backoffice_tenants")
    .select("organization_id, affiliate_code, plan_amount_cents, updated_at, organizations(status)")
    .order("updated_at", { ascending: true })
    .limit(PAGINA_ASSINATURAS);
  if (updatedSince) query = query.gte("updated_at", updatedSince);
  const { data, error } = await query;
  if (error) return { status: 500, body: { error: "query_failed" } };
  const linhas = (data ?? []) as unknown as LinhaVinculo[];
  return {
    status: 200,
    body: {
      items: linhas.map((l) => ({
        customer_external_id: l.organization_id,
        subscription_external_id: l.organization_id,
        status: statusDe(l),
        amount_cents: l.plan_amount_cents,
        affiliate_code: l.affiliate_code,
        updated_at: l.updated_at,
      })),
      next_cursor: linhas.length === PAGINA_ASSINATURAS ? linhas.at(-1)!.updated_at : null,
    },
  };
}
