import { emitirParaBackoffice, precoComDesconto, registrarIndicacao } from "@/lib/backoffice/saida";
import { abrirAssinatura } from "@/lib/billing/servico";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

/** Normaliza o nome da empresa para um slug candidato (citext unique no DB). */
function slugify(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "org";
}

type ProvisionUser = {
  id: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

/**
 * Provisiona o tenant de um usuário recém-confirmado via signup self-service:
 * cria a organização JÁ PRONTA (status `active`, `onboarded_at` preenchido) e a
 * membership `admin` do usuário. A pessoa entra direto no CRM — o assistente de
 * `/onboarding` não aparece para quem veio do cadastro: tudo o que ele pedia de
 * indispensável (nome, empresa, contato, aceite dos termos) já veio no
 * formulário de cadastro, em `user_metadata`.
 *
 * Idempotente: se o usuário já tem membership ativa (link de confirmação
 * clicado duas vezes, ou usuário que entrou antes por convite), não faz nada.
 *
 * Service role é intencional aqui — o usuário ainda não pertence a nenhuma org,
 * então RLS bloquearia os INSERTs. A fonte confiável é o JWT já validado por
 * `verifyOtp` no caller (nunca o body).
 */
export async function ensureTenantForUser(
  user: ProvisionUser,
): Promise<{ provisioned: boolean; organizationId?: string }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (existing) return { provisioned: false, organizationId: existing.organization_id };

  const orgName =
    (user.user_metadata?.org_name as string | undefined)?.trim() ||
    user.email?.split("@")[0] ||
    "Minha empresa";
  const base = slugify(orgName);

  // ponytail: check-then-insert tem janela de corrida se o mesmo link for
  // confirmado 2x em paralelo (pior caso: org duplicada órfã). Advisory lock
  // por user_id se isso aparecer na prática.
  let org: { id: string; slug: string } | null = null;
  for (let attempt = 0; attempt < 3 && !org; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await admin
      .from("organizations")
      .insert({
        slug,
        display_name: orgName,
        legal_name: orgName,
        status: "active",
        created_by: user.id,
        onboarded_at: new Date().toISOString(),
      })
      .select("id, slug")
      .single();
    if (data) {
      org = data;
    } else if (error && error.code !== "23505") {
      throw new Error(`signup provisioning: org insert failed: ${error.message}`);
    }
  }
  if (!org) throw new Error("signup provisioning: slug exhausted after 3 attempts");

  const { error: memberError } = await admin.from("user_organizations").insert({
    user_id: user.id,
    organization_id: org.id,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });
  if (memberError && memberError.code !== "23505") {
    throw new Error(`signup provisioning: membership insert failed: ${memberError.message}`);
  }

  // Teste grátis: a assinatura nasce junto da organização do cadastro. Se esta
  // gravação falhar, `lerAssinatura` abre o trial do `created_at` na primeira
  // leitura — nunca uma isenção por acidente.
  //
  // Veio pelo link de um afiliado do Back Office? O código (revalidado lá)
  // vira indicação, e o desconto dele já entra na mensalidade: toda cobrança
  // do Asaas — a primeira e as renovações — sai com o valor descontado.
  const indicacao = await registrarIndicacao(
    admin,
    org.id,
    user.user_metadata?.affiliate_code as string | undefined,
  ).catch(() => null);
  await abrirAssinatura(admin, org.id, {
    valorCentavos: precoComDesconto(env.COBRANCA_VALOR_CENTAVOS, indicacao?.desconto_bps ?? null),
  }).catch(() => undefined);
  // O Back Office passa a conhecer o cliente (e o afiliado, se houver) já no
  // cadastro — o afiliado vê a indicação antes do primeiro pagamento.
  await emitirParaBackoffice(admin, org.id, [
    { event_id: `crm_org_${org.id}_created`, type: "customer.created", occurred_at: new Date().toISOString() },
  ]);

  void audit({
    action: "tenant.created_by_signup",
    actorUserId: user.id,
    organizationId: org.id,
    resourceType: "organization",
    resourceId: org.id,
    bypassedRls: true,
    metadata: {
      slug: org.slug,
      // O aceite dos termos é gravado no cadastro (`signUp.ts`); aqui ele
      // fica registrado no audit, que é append-only.
      accepted_terms_at: (user.user_metadata?.accepted_terms_at as string | undefined) ?? null,
    },
  });

  // Os mesmos efeitos de `finishOnboarding` — quem escuta `tenant.onboarded`
  // não pode deixar de ouvir só porque o assistente saiu do caminho.
  await admin
    .from("event_log")
    .insert({
      organization_id: org.id,
      event_type: "tenant.onboarded",
      payload: { completed_by: user.id, origem: "cadastro" },
    })
    .then(
      () => undefined,
      () => undefined,
    );
  void audit({
    action: "onboarding.completed",
    actorUserId: user.id,
    organizationId: org.id,
    metadata: { origem: "cadastro" },
  });

  return { provisioned: true, organizationId: org.id };
}
