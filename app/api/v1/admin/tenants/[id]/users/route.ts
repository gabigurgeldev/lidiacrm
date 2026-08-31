/**
 * POST /api/v1/admin/tenants/[id]/users — cria uma pessoa dentro de um tenant,
 * a partir do painel da plataforma.
 *
 * Existe porque o painel sabia criar organização e não sabia criar ninguém
 * dentro dela. `POST /api/v1/admin/tenants` até coleta `owner_email`, mas só o
 * transforma em hash para o audit — o tenant nascia SEM DONO, e ninguém
 * conseguia entrar nele. A aba "Equipe" da tela do tenant existia marcada como
 * "em breve"; é esta rota que a sustenta.
 *
 * O miolo é o mesmo da tela de equipe do tenant (`lib/auth/criar-usuario.ts`).
 * Duas implementações divergiriam no primeiro ajuste, e o ajuste que divergisse
 * seria o de permissão.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { criarUsuarioNaOrganizacao } from "@/lib/auth/criar-usuario";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { criarMembroSchema, validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();

  let adminCtx: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try {
    adminCtx = await requirePlatformAdmin();
  } catch {
    return fail("forbidden", "Platform admin required", 403, { requestId });
  }

  // O tenant vem do PATH, que o guard de platform admin já autoriza — nunca do
  // body (CLAUDE.md, anti-pattern 10). Aqui a distinção é sutil e importa: o
  // platform admin pode agir sobre qualquer organização, então o que protege
  // não é o escopo dele, é o path ser a única fonte do alvo.
  const { id: organizationId } = await ctx.params;

  let input;
  try {
    input = await validateRequest(criarMembroSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  const admin = createAdminClient();

  // A organização existe? Sem isto, um id errado criaria uma conta de verdade
  // vinculada a uma organização que não existe — e a FK só barraria depois de o
  // usuário já ter nascido no Auth.
  const { data: org } = await admin
    .from("organizations")
    .select("id, display_name")
    .eq("id", organizationId)
    .maybeSingle();

  if (!org) {
    return fail("not_found", "Organização não encontrada.", 404, { requestId });
  }

  const r = await criarUsuarioNaOrganizacao({
    admin,
    organizationId,
    atorUserId: adminCtx.user.id,
    email: input.email,
    senha: input.senha,
    papel: input.role,
    ...(input.nome ? { nome: input.nome } : {}),
    requestId,
  });

  if (!r.ok) {
    if (r.motivo === "ja_e_membro") {
      return fail("conflict", "Esta pessoa já faz parte desta organização.", 409, { requestId });
    }
    return fail("internal_error", "Não consegui criar o acesso agora.", 500, { requestId });
  }

  // Audit PRÓPRIO do platform admin, além do `member.created` que o miolo já
  // emite: a ação atravessou a fronteira de tenant, e quem lê a trilha da
  // plataforma precisa ver isso sem ter de cruzar com a trilha da organização.
  void audit({
    action: "platform_admin.user_created",
    actorUserId: adminCtx.user.id,
    actingAsPlatformAdmin: true,
    bypassedRls: true,
    organizationId,
    resourceType: "user",
    resourceId: r.userId,
    requestId,
    metadata: { papel: input.role, criou_conta: r.criouConta },
  });

  return ok(
    { user_id: r.userId, role: input.role, conta_criada: r.criouConta },
    { status: 201, requestId },
  );
}
