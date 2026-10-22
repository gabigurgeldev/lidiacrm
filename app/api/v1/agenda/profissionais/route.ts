/**
 * `/api/v1/agenda/profissionais` — quem atende (migration 0245).
 *
 * Toda pessoa agendável é uma linha em `calendar_professionals`. O login é
 * OPCIONAL: a maioria das profissionais de uma clínica nunca entra no sistema, e
 * não ocupa vaga de usuário. Quem tem login é vinculada pelo `user_id`, e a
 * jornada dela é a mesma de Equipe › Atendimento.
 *
 *   GET  → `ItemDaProfissional[]` — `{ id, nome, trilha, ativo, user_id, jornada,
 *          jornada_fonte: 'membro'|'propria', tipos: uuid[] }`, ativas e desativadas
 *   POST `{ nome, trilha?, user_id?, jornada?, tipos? }` → 201 o item
 *          409 `state_conflict` se o membro já está vinculado a outra profissional
 *
 * PATCH e DELETE moram em `[id]/route.ts`.
 *
 * Papéis: `viewer` lê (a barra de pessoas da Agenda), `manager` escreve —
 * mudar quem atende muda os horários que a IA oferece ao cliente.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  exigeMembroLivre,
  exigeTiposDaOrg,
  gravarJornadaDoMembro,
  gravarTiposDaProfissional,
  itensDasProfissionais,
  RecusaDaProfissional,
} from "./_itens";
import { criarProfissionalSchema } from "./_schemas";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "calendar_professionals" });
  if (!authz.ok) return authz.response;

  try {
    const itens = await itensDasProfissionais(createAdminClient(), authz.org.orgId);
    return ok(itens, { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "calendar_professionals" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const lido = criarProfissionalSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      details: lido.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const entrada = lido.data;
  const admin = createAdminClient();

  try {
    if (entrada.user_id) await exigeMembroLivre(admin, org, entrada.user_id);
    if (entrada.tipos) await exigeTiposDaOrg(admin, org, entrada.tipos);

    const { data: criada, error } = await admin
      .from("calendar_professionals")
      .insert({
        organization_id: org,
        name: entrada.nome,
        trilha: entrada.trilha ?? null,
        user_id: entrada.user_id ?? null,
        // Com login, a jornada mora no membro — a linha não pode ter as duas
        // (CHECK `calendar_professionals_jornada_tem_uma_fonte`).
        schedule: entrada.user_id ? null : (entrada.jornada ?? null),
      })
      .select("id")
      .single();
    if (error) {
      // 23505 no índice parcial do membro: outra requisição vinculou no meio.
      if (error.code === "23505") {
        return fail("state_conflict", "Este membro já está vinculado a outra profissional.", 409, { requestId });
      }
      return fail("internal_error", error.message, 500, { requestId });
    }
    const id = (criada as { id: string }).id;

    if (entrada.user_id && entrada.jornada) await gravarJornadaDoMembro(admin, org, entrada.user_id, entrada.jornada);
    if (entrada.tipos) await gravarTiposDaProfissional(admin, org, id, entrada.tipos);

    void audit({
      action: "agenda.profissional_criado",
      actorUserId: authz.user.id,
      organizationId: org,
      resourceType: "calendar_professional",
      resourceId: id,
      requestId,
      metadata: {
        nome: entrada.nome,
        vinculada_a_membro: Boolean(entrada.user_id),
        tipos: entrada.tipos ?? [],
      },
    });

    const [item] = await itensDasProfissionais(admin, org, [id]);
    return ok(item, { requestId, status: 201 });
  } catch (err) {
    if (err instanceof RecusaDaProfissional) return fail(err.codigo, err.message, err.status, { requestId });
    logger.error("agenda: falha ao criar profissional", { erro: (err as Error).message, requestId });
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}
