/**
 * PATCH /api/v1/team/[user_id]/dados — o admin da empresa edita nome, e-mail
 * e senha de uma pessoa da própria equipe.
 *
 * Antes só o painel da PLATAFORMA editava uma conta; o dono da empresa criava a
 * pessoa com e-mail e senha e, se errasse um dos dois, não tinha como consertar
 * — só revogar e criar outra.
 *
 * Organização da SESSÃO, alvo do PATH, nunca do body (anti-pattern 10). Os
 * limites (outra empresa, admin da plataforma, própria conta) estão em
 * `lib/team/editar-membro.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { hashDeEmail } from "@/lib/admin/gestao-usuarios";
import { situacaoDePlataforma } from "@/lib/admin/consultas-gestao";
import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit, isServiceRoleConfigured } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { editarMembroSchema, validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { recusaDeEdicaoDoMembro } from "@/lib/team/editar-membro";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ user_id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const { user_id: alvoId } = await ctx.params;

  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  if (!z.string().uuid().safeParse(alvoId).success) {
    return fail("not_found", "Membro não encontrado.", 404, { requestId });
  }

  let input;
  try {
    input = await validateRequest(editarMembroSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  if (!isServiceRoleConfigured()) {
    return fail(
      "unavailable",
      "Esta instalação está sem a chave de serviço do Supabase (SUPABASE_SERVICE_ROLE_KEY), " +
        "necessária para editar contas. Avise quem administra o servidor.",
      503,
      { requestId },
    );
  }

  const admin = createAdminClient();

  // Vínculos ativos do alvo: o desta empresa precisa existir; os de outras
  // decidem se e-mail e senha podem mudar.
  const { data: vinculos, error: vincErr } = await admin
    .from("user_organizations")
    .select("organization_id")
    .eq("user_id", alvoId)
    .is("revoked_at", null);
  if (vincErr) return fail("internal_error", "Não consegui conferir a equipe agora.", 500, { requestId });
  const orgs = (vinculos ?? []).map((v) => v.organization_id as string);
  if (!orgs.includes(activeOrg.orgId)) {
    return fail("not_found", "Membro não encontrado.", 404, { requestId });
  }

  const plataforma = await situacaoDePlataforma(admin, alvoId);
  if ("erro" in plataforma) {
    return fail("internal_error", "Não consegui conferir a conta agora.", 500, { requestId });
  }

  const recusa = recusaDeEdicaoDoMembro({
    atorId: authUser.id,
    alvoId,
    alvoEhPlatformAdmin: plataforma.alvoEhPlatformAdmin,
    outrasEmpresasAtivas: orgs.filter((o) => o !== activeOrg.orgId).length,
    mudaAcesso: input.email !== undefined || input.senha !== undefined,
  });
  if (recusa) {
    return fail(recusa.status === 403 ? "forbidden" : "state_conflict", recusa.message, recusa.status, {
      requestId,
      details: { motivo: recusa.motivo },
    });
  }

  const { data: atual, error: getErr } = await admin.auth.admin.getUserById(alvoId);
  if (getErr || !atual?.user) {
    return fail("not_found", "Membro não encontrado.", 404, { requestId });
  }

  const mudancas: Parameters<typeof admin.auth.admin.updateUserById>[1] = {};
  const campos: string[] = [];

  if (input.nome !== undefined) {
    // Metadado INTEIRO com o nome trocado: um replace apagaria idioma, fuso e
    // avatar da pessoa.
    mudancas.user_metadata = { ...(atual.user.user_metadata ?? {}), full_name: input.nome || null };
    campos.push("full_name");
  }
  if (input.email !== undefined && input.email !== atual.user.email) {
    // Confirmado por quem administra: esperar confirmação por e-mail travaria
    // o login numa instalação sem SMTP.
    mudancas.email = input.email;
    mudancas.email_confirm = true;
    campos.push("email");
  }
  if (input.senha !== undefined) {
    mudancas.password = input.senha;
    campos.push("senha");
  }

  if (campos.length === 0) return ok({ user_id: alvoId, changed: [] }, { requestId });

  const { error: updErr } = await admin.auth.admin.updateUserById(alvoId, mudancas);
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
    const senhaFraca =
      (updErr as { code?: string }).code === "weak_password" || /password/i.test(updErr.message);
    if (senhaFraca) {
      return fail("validation_failed", "Esta senha não é aceita. Tente uma mais longa.", 422, {
        requestId,
      });
    }
    return fail("internal_error", "Não consegui salvar a alteração agora.", 500, { requestId });
  }

  await audit({
    action: "team.member_updated",
    actorUserId: authUser.id,
    organizationId: activeOrg.orgId,
    resourceType: "user",
    resourceId: alvoId,
    requestId,
    // Nunca a senha, nem o e-mail em claro.
    metadata: {
      campos,
      ...(campos.includes("email")
        ? { email_anterior_hash: hashDeEmail(atual.user.email), email_novo_hash: hashDeEmail(input.email) }
        : {}),
    },
  });

  return ok({ user_id: alvoId, changed: campos }, { requestId });
}
