import { type NextRequest } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { situacaoDePlataforma, orgsOndeEhUltimoAdmin } from "@/lib/admin/consultas-gestao";
import {
  estadoDaConta,
  hashDeEmail,
  recusaDeAcaoNaConta,
  type SuspensaoRegistrada,
} from "@/lib/admin/gestao-usuarios";
import { exigirPlatformAdmin, lerCorpo } from "@/lib/admin/rota-da-plataforma";

// ---------------------------------------------------------------------------
// GET /api/v1/admin/users/[id]
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const { id } = await params;

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  const admin = createAdminClient();

  // Load auth user via admin auth API
  const { data: authUserData, error: authError } =
    await admin.auth.admin.getUserById(id);

  if (authError || !authUserData?.user) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const authUser = authUserData.user;

  // Load memberships (user_organizations + organizations join)
  const { data: memberships, error: membershipError } = await admin
    .from("user_organizations")
    .select(
      `
      organization_id,
      role,
      accepted_at,
      revoked_at,
      organizations(display_name, slug)
    `,
    )
    .eq("user_id", id)
    .order("accepted_at", { ascending: false });

  if (membershipError) {
    return fail("internal_error", "Membership query failed", 500, {
      requestId,
      details: membershipError.message,
    });
  }

  type RawMembership = {
    organization_id: string;
    role: string;
    accepted_at: string | null;
    revoked_at: string | null;
    organizations: { display_name: string; slug: string } | null;
  };

  const formattedMemberships = ((memberships ?? []) as unknown as RawMembership[]).map(
    (m) => ({
      organization_id: m.organization_id,
      tenant_name: m.organizations?.display_name ?? null,
      tenant_slug: m.organizations?.slug ?? null,
      role: m.role,
      accepted_at: m.accepted_at,
      revoked_at: m.revoked_at,
    }),
  );

  // Load recent audit entries where actor_user_id = id (LIMIT 50)
  const { data: recentAudit, error: auditError } = await admin
    .from("api_audit_log")
    .select(
      "id, action, organization_id, resource_type, resource_id, created_at, metadata",
    )
    .eq("actor_user_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (auditError) {
    // Non-fatal: return empty array and continue
  }

  const userMeta = authUser.user_metadata as Record<string, unknown> | null;
  const bannedUntil = (authUser as { banned_until?: string | null }).banned_until ?? null;
  const plataforma = await situacaoDePlataforma(admin, id);

  const userPayload = {
    id: authUser.id,
    email: authUser.email ?? null,
    full_name: (userMeta?.full_name as string | undefined) ?? null,
    phone: authUser.phone ?? null,
    last_sign_in_at: authUser.last_sign_in_at ?? null,
    created_at: authUser.created_at,
    email_confirmed_at: authUser.email_confirmed_at ?? null,
    factors: (authUser.factors ?? []).map((f) => ({
      id: f.id,
      type: f.factor_type,
      status: f.status,
    })),
    banned_until: bannedUntil,
    status: estadoDaConta({
      banned_until: bannedUntil,
      email_confirmed_at: authUser.email_confirmed_at ?? null,
      last_sign_in_at: authUser.last_sign_in_at ?? null,
    }),
    // Motivo e autor da suspensão. Moram em `app_metadata`, que só a service
    // role escreve — o usuário não consegue apagar o registro da própria
    // suspensão pelo `updateUser` do cliente.
    suspensao: (authUser.app_metadata?.suspensao as SuspensaoRegistrada | null | undefined) ?? null,
    is_platform_admin:
      "erro" in plataforma ? false : plataforma.alvoEhPlatformAdmin,
  };

  void audit({
    action: "platform_admin.user_viewed",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "user",
    resourceId: id,
    requestId,
    metadata: {
      email_hash: authUser.email
        ? Buffer.from(authUser.email.toLowerCase()).toString("hex").slice(0, 12) +
          "..."
        : null,
    },
  });

  return ok(
    {
      user: userPayload,
      memberships: formattedMemberships,
      recent_audit: recentAudit ?? [],
    },
    { requestId },
  );
}

// ---------------------------------------------------------------------------
// PATCH /api/v1/admin/users/[id] — editar nome e/ou e-mail
// ---------------------------------------------------------------------------

const idSchema = z.string().uuid();

const editarSchema = z
  .object({
    full_name: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().toLowerCase().email().optional(),
  })
  .refine((v) => v.full_name !== undefined || v.email !== undefined, {
    message: "Informe ao menos um campo para alterar.",
  });

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const corpo = await lerCorpo(editarSchema, req, requestId);
  if (!corpo.ok) return corpo.response;
  const input = corpo.dados;

  const admin = createAdminClient();
  const { data: atual, error: getErr } = await admin.auth.admin.getUserById(id);
  if (getErr || !atual?.user) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const mudancas: Parameters<typeof admin.auth.admin.updateUserById>[1] = {};
  const campos: string[] = [];

  if (input.full_name !== undefined) {
    // Metadado INTEIRO, com o nome trocado: não depender de o GoTrue fundir
    // `user_metadata` — um replace apagaria idioma, fuso e avatar da pessoa.
    mudancas.user_metadata = {
      ...(atual.user.user_metadata ?? {}),
      full_name: input.full_name ? input.full_name : null,
    };
    campos.push("full_name");
  }
  if (input.email !== undefined && input.email !== atual.user.email) {
    // `email_confirm: true`: quem troca é a administração da instalação, que
    // já sabe qual é o endereço certo. Sem isto a conta ficaria esperando uma
    // confirmação que depende de SMTP configurado — o que um self-host novo
    // quase nunca tem.
    mudancas.email = input.email;
    mudancas.email_confirm = true;
    campos.push("email");
  }

  if (campos.length === 0) {
    return ok({ id, changed: [] }, { requestId });
  }

  const { error: updErr } = await admin.auth.admin.updateUserById(id, mudancas);
  if (updErr) {
    const jaExiste =
      (updErr as { code?: string }).code === "email_exists" ||
      /already (been )?registered|already exists/i.test(updErr.message);
    if (jaExiste) {
      return fail("state_conflict", "Já existe uma conta com este e-mail.", 409, {
        requestId,
        details: { motivo: "email_em_uso" },
      });
    }
    return fail("internal_error", "Não consegui salvar a alteração agora.", 500, {
      requestId,
      details: updErr.message,
    });
  }

  void audit({
    action: "platform_admin.user_updated",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "user",
    resourceId: id,
    requestId,
    metadata: {
      campos,
      ...(campos.includes("email")
        ? { email_anterior_hash: hashDeEmail(atual.user.email), email_novo_hash: hashDeEmail(input.email) }
        : {}),
    },
  });

  return ok({ id, changed: campos }, { requestId });
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/admin/users/[id] — excluir a conta
// ---------------------------------------------------------------------------

const excluirSchema = z.object({
  // Digitar o e-mail do alvo é a confirmação. Um clique só não basta para uma
  // ação que não tem volta.
  confirm_email: z.string().trim().toLowerCase().email(),
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!idSchema.safeParse(id).success) {
    return fail("not_found", "User not found", 404, { requestId });
  }

  const corpo = await lerCorpo(excluirSchema, req, requestId);
  if (!corpo.ok) return corpo.response;

  const admin = createAdminClient();
  const { data: alvo, error: getErr } = await admin.auth.admin.getUserById(id);
  if (getErr || !alvo?.user) {
    return fail("not_found", "User not found", 404, { requestId });
  }
  if ((alvo.user.email ?? "").toLowerCase() !== corpo.dados.confirm_email) {
    return fail("validation_failed", "O e-mail digitado não confere com o da conta.", 422, {
      requestId,
    });
  }

  const plataforma = await situacaoDePlataforma(admin, id);
  if ("erro" in plataforma) {
    return fail("internal_error", "Não consegui conferir a conta agora.", 500, { requestId });
  }
  const recusa = recusaDeAcaoNaConta({
    acao: "excluir",
    atorId: gate.ctx.user.id,
    alvoId: id,
    ...plataforma,
  });
  if (recusa) {
    return fail("state_conflict", recusa.message, 409, {
      requestId,
      details: { motivo: recusa.motivo },
    });
  }

  // Excluir o último admin de uma organização a deixaria sem ninguém capaz de
  // gerir a própria equipe. A saída é promover outra pessoa antes.
  const presas = await orgsOndeEhUltimoAdmin(admin, id);
  if ("erro" in presas) {
    return fail("internal_error", "Não consegui conferir a conta agora.", 500, { requestId });
  }
  if (presas.length > 0) {
    return fail(
      "state_conflict",
      "Esta pessoa é a única administradora de uma ou mais organizações. Promova outra pessoa antes de excluir.",
      409,
      { requestId, details: { motivo: "ultimo_admin", organizacoes: presas } },
    );
  }

  const agoraIso = new Date().toISOString();

  // Vínculos primeiro: se o Auth falhar depois, a pessoa só perdeu o acesso às
  // organizações (reversível pelo painel), e não ficou uma conta excluída ainda
  // listada como membro.
  const { error: revErr } = await admin
    .from("user_organizations")
    .update({ revoked_at: agoraIso, updated_at: agoraIso })
    .eq("user_id", id)
    .is("revoked_at", null);
  if (revErr) {
    return fail("internal_error", "Não consegui remover os vínculos agora.", 500, { requestId });
  }

  if (plataforma.alvoEhPlatformAdmin) {
    await admin.from("platform_admins").update({ revoked_at: agoraIso }).eq("user_id", id);
  }

  // SOFT delete (segundo argumento `true`): o GoTrue marca `deleted_at` e
  // anonimiza e-mail/telefone, mas a linha fica — e com ela toda FK de
  // histórico (autor de nota, de mensagem, de audit). Um hard delete dispararia
  // `on delete set null`/`cascade` em tabelas de histórico: a "cascade
  // fantasma" do anti-pattern 7.
  const { error: delErr } = await admin.auth.admin.deleteUser(id, true);
  if (delErr) {
    return fail("internal_error", "Não consegui excluir a conta agora.", 500, {
      requestId,
      details: delErr.message,
    });
  }

  void audit({
    action: "platform_admin.user_deleted",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    resourceType: "user",
    resourceId: id,
    requestId,
    metadata: {
      email_hash: hashDeEmail(alvo.user.email),
      era_platform_admin: plataforma.alvoEhPlatformAdmin,
      soft_delete: true,
    },
  });

  return ok({ id, deleted_at: agoraIso }, { requestId });
}
