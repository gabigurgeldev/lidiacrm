/**
 * O vínculo de UMA pessoa com UMA organização, pelo painel da plataforma.
 *
 *   PATCH  — troca o papel na organização;
 *   DELETE — remove a pessoa da organização (`revoked_at`), sem tocar na conta.
 *
 * Mesmas travas da tela de equipe do tenant (`app/api/v1/team/[user_id]/_shared.ts`
 * e `/revoke`): o último admin não é rebaixado nem removido, e vínculo já
 * revogado não muda. A diferença é o escopo: lá a organização é a ATIVA de
 * quem pede; aqui ela vem do PATH, que o gate de platform admin autoriza —
 * nunca do body.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { adminsAtivosDaOrg } from "@/lib/admin/consultas-gestao";
import { recusaDeMudancaNoVinculo } from "@/lib/admin/gestao-usuarios";
import { exigirPlatformAdmin, lerCorpo } from "@/lib/admin/rota-da-plataforma";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { changeRoleSchema } from "@/lib/schemas";
import type { Role } from "@/lib/schemas/team";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; orgId: string }> };

const uuid = z.string().uuid();

async function carregar(requestId: string, ctx: Ctx) {
  const { id, orgId } = await ctx.params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(orgId).success) {
    return { ok: false as const, response: fail("not_found", "Vínculo não encontrado.", 404, { requestId }) };
  }
  const admin = createAdminClient();
  const { data: vinculo, error } = await admin
    .from("user_organizations")
    .select("id, role, revoked_at")
    .eq("organization_id", orgId)
    .eq("user_id", id)
    .maybeSingle();
  if (error) {
    return { ok: false as const, response: fail("internal_error", error.message, 500, { requestId }) };
  }
  if (!vinculo) {
    return { ok: false as const, response: fail("not_found", "Vínculo não encontrado.", 404, { requestId }) };
  }
  const admins = await adminsAtivosDaOrg(admin, orgId);
  if (typeof admins !== "number") {
    return { ok: false as const, response: fail("internal_error", admins.erro, 500, { requestId }) };
  }
  return { ok: true as const, admin, id, orgId, vinculo, admins };
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const corpo = await lerCorpo(changeRoleSchema, req, requestId);
  if (!corpo.ok) return corpo.response;

  const c = await carregar(requestId, ctx);
  if (!c.ok) return c.response;

  const papelAtual = c.vinculo.role as Role;
  const papelNovo = corpo.dados.role;
  const recusa = recusaDeMudancaNoVinculo({
    papelAtual,
    papelNovo,
    revogado: !!c.vinculo.revoked_at,
    adminsAtivosNaOrg: c.admins,
  });
  if (recusa) {
    return fail("state_conflict", recusa.message, 409, { requestId, details: { motivo: recusa.motivo } });
  }
  if (papelAtual === papelNovo) {
    return ok({ user_id: c.id, organization_id: c.orgId, role: papelNovo }, { requestId });
  }

  const { error } = await c.admin
    .from("user_organizations")
    .update({ role: papelNovo, updated_at: new Date().toISOString() })
    .eq("id", c.vinculo.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: "platform_admin.user_role_changed",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: c.orgId,
    resourceType: "membership",
    resourceId: c.vinculo.id,
    requestId,
    metadata: { target_user_id: c.id, de: papelAtual, para: papelNovo },
  });

  return ok({ user_id: c.id, organization_id: c.orgId, role: papelNovo }, { requestId });
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const gate = await exigirPlatformAdmin(requestId);
  if (!gate.ok) return gate.response;

  const c = await carregar(requestId, ctx);
  if (!c.ok) return c.response;

  const recusa = recusaDeMudancaNoVinculo({
    papelAtual: c.vinculo.role as Role,
    papelNovo: null,
    revogado: !!c.vinculo.revoked_at,
    adminsAtivosNaOrg: c.admins,
  });
  if (recusa) {
    return fail("state_conflict", recusa.message, 409, { requestId, details: { motivo: recusa.motivo } });
  }

  const agoraIso = new Date().toISOString();
  const { error } = await c.admin
    .from("user_organizations")
    .update({ revoked_at: agoraIso, updated_at: agoraIso })
    .eq("id", c.vinculo.id);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  void audit({
    action: "platform_admin.user_removed_from_org",
    actorUserId: gate.ctx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId: c.orgId,
    resourceType: "membership",
    resourceId: c.vinculo.id,
    requestId,
    metadata: { target_user_id: c.id, revoked_role: c.vinculo.role },
  });

  return ok({ user_id: c.id, organization_id: c.orgId, revoked_at: agoraIso }, { requestId });
}
