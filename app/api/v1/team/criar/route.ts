/**
 * POST /api/v1/team/criar — cria a pessoa direto, com e-mail e senha.
 *
 * Substitui o convite por e-mail como caminho de entrada no tenant. O convite
 * dependia de `RESEND_API_KEY`; sem ela — o estado de toda instalação recém-
 * feita — a tela terminava mostrando um link cru para copiar à mão. Um caminho
 * de entrada que só funciona com e-mail configurado não funciona no dia da
 * instalação, que é justamente o dia em que se monta o time.
 *
 * O miolo mora em `lib/auth/criar-usuario.ts`, compartilhado com o painel da
 * plataforma. Aqui ficam auth, papel de quem chama e formato do erro.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ApiError } from "@/lib/api/types";
import { fail, ok } from "@/lib/api/wrappers";
import { criarUsuarioNaOrganizacao } from "@/lib/auth/criar-usuario";
import { requireRole } from "@/lib/auth/require-role";
import { isServiceRoleConfigured } from "@/lib/audit";
import { criarMembroSchema, validateRequest } from "@/lib/schemas";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

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

  // Criar conta exige a chave de serviço. Sem ela a operação não é possível, e
  // dizer isso é melhor que falhar com erro genérico depois de a pessoa ter
  // preenchido o formulário inteiro.
  if (!isServiceRoleConfigured()) {
    return fail(
      "unavailable",
      "Esta instalação está sem a chave de serviço do Supabase (SUPABASE_SERVICE_ROLE_KEY), " +
        "necessária para criar contas. Avise quem administra o servidor.",
      503,
      { requestId },
    );
  }

  const r = await criarUsuarioNaOrganizacao({
    admin: createAdminClient(),
    // Da SESSÃO, nunca do body — o body escolheria a organização de outro
    // (CLAUDE.md, anti-pattern 10).
    organizationId: activeOrg.orgId,
    atorUserId: authUser.id,
    email: input.email,
    senha: input.senha,
    papel: input.role,
    ...(input.nome ? { nome: input.nome } : {}),
    requestId,
  });

  if (!r.ok) {
    if (r.motivo === "ja_e_membro") {
      return fail("conflict", "Esta pessoa já faz parte da equipe.", 409, { requestId });
    }
    return fail("internal_error", "Não consegui criar o acesso agora.", 500, { requestId });
  }

  return ok(
    {
      user_id: r.userId,
      role: input.role,
      // Diz a QUEM OPERA o que aconteceu de fato: se a conta já existia (a
      // pessoa trabalha em outra organização desta instalação), a senha digitada
      // NÃO foi aplicada — ela entra com a senha que já tinha. Esconder isso
      // faria alguém repassar uma senha que não funciona.
      conta_criada: r.criouConta,
    },
    { status: 201, requestId },
  );
}
