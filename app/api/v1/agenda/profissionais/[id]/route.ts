/**
 * `/api/v1/agenda/profissionais/{id}` — alterar e desativar uma profissional.
 *
 *   PATCH  `{ nome?, trilha?, ativo?, user_id?, jornada?, tipos? }` → o item
 *   DELETE → `{ id, ativo: false }` (desativa; NUNCA apaga)
 *
 * ─── Vínculo com membro: só se cria, nunca se desfaz ─────────────────────────
 *
 * `user_id: null` é recusado (422, no schema): o backfill que o `update.sh`
 * re-aplica cria um profissional para todo membro com agenda — desvincular
 * faria a pessoa ganhar uma SEGUNDA linha na próxima atualização. Trocar para
 * outro membro também é recusado: é outra pessoa, e o histórico de quem atendeu
 * cada agendamento não se transfere. O que se faz é desativar.
 *
 * ─── Desativar, nunca apagar ──────────────────────────────────────────────────
 *
 * `calendar_appointment_professionals` aponta para cá (`on delete no action`):
 * apagar levaria junto a resposta a "quem fez este atendimento?". Desativada,
 * ela some da oferta de horários e continua respondendo pelo passado.
 *
 * Papel `manager` — mudar quem atende muda o que a IA oferece ao cliente.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

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
  linhaDaProfissional,
  RecusaDaProfissional,
} from "../_itens";
import { alterarProfissionalSchema } from "../_schemas";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "calendar_professionals" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });

  const lido = alterarProfissionalSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      details: lido.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const entrada = lido.data;
  const admin = createAdminClient();

  try {
    const atual = await linhaDaProfissional(admin, org, id.data);
    if (!atual) return fail("not_found", "Profissional não encontrada.", 404, { requestId });

    const mudanca: Record<string, unknown> = {};
    if (entrada.nome !== undefined) mudanca.name = entrada.nome;
    if (entrada.trilha !== undefined) mudanca.trilha = entrada.trilha;
    if (entrada.ativo !== undefined) mudanca.is_active = entrada.ativo;

    // O membro por trás dela, DEPOIS desta alteração.
    let userId = atual.user_id;
    let vinculouAgora = false;
    if (entrada.user_id && entrada.user_id !== atual.user_id) {
      if (atual.user_id) {
        return fail(
          "agenda_profissional_invalido",
          "Esta profissional já está vinculada a outro membro. Desative-a e cadastre uma nova.",
          422,
          { requestId },
        );
      }
      await exigeMembroLivre(admin, org, entrada.user_id, atual.id);
      userId = entrada.user_id;
      vinculouAgora = true;
      mudanca.user_id = userId;
      // A jornada passa a ser a do membro: a linha não pode ter as duas.
      mudanca.schedule = null;
    }

    if (entrada.tipos) await exigeTiposDaOrg(admin, org, entrada.tipos);

    if (entrada.jornada !== undefined && !userId) mudanca.schedule = entrada.jornada;

    if (Object.keys(mudanca).length > 0) {
      const { error } = await admin
        .from("calendar_professionals")
        .update(mudanca)
        .eq("organization_id", org)
        .eq("id", atual.id);
      if (error) {
        if (error.code === "23505") {
          return fail("state_conflict", "Este membro já está vinculado a outra profissional.", 409, { requestId });
        }
        return fail("internal_error", error.message, 500, { requestId });
      }
    }

    if (userId) {
      // Jornada de quem tem login mora em `attendant_availability`. Ao vincular
      // sem mandar jornada, a própria que ela tinha vai para o membro — mas só
      // se ele ainda não publicou a dele (a do membro é a que vale).
      const jornada =
        entrada.jornada ??
        (vinculouAgora && atual.schedule ? await jornadaSeMembroSemAgenda(admin, org, userId, atual.schedule) : null);
      if (jornada) await gravarJornadaDoMembro(admin, org, userId, jornada as never);
    }

    if (entrada.tipos) await gravarTiposDaProfissional(admin, org, atual.id, entrada.tipos);

    const desativou = entrada.ativo === false && atual.is_active;
    void audit({
      action: desativou ? "agenda.profissional_desativado" : "agenda.profissional_alterado",
      actorUserId: authz.user.id,
      organizationId: org,
      resourceType: "calendar_professional",
      resourceId: atual.id,
      requestId,
      metadata: { campos: Object.keys(entrada).filter((k) => entrada[k as keyof typeof entrada] !== undefined) },
    });

    const [item] = await itensDasProfissionais(admin, org, [atual.id]);
    return ok(item, { requestId });
  } catch (err) {
    if (err instanceof RecusaDaProfissional) return fail(err.codigo, err.message, err.status, { requestId });
    logger.error("agenda: falha ao alterar profissional", { erro: (err as Error).message, requestId });
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "calendar_professionals" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendar_professionals")
    .update({ is_active: false })
    .eq("organization_id", org)
    .eq("id", id.data)
    .select("id")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Profissional não encontrada.", 404, { requestId });

  void audit({
    action: "agenda.profissional_desativado",
    actorUserId: authz.user.id,
    organizationId: org,
    resourceType: "calendar_professional",
    resourceId: id.data,
    requestId,
    metadata: {},
  });
  return ok({ id: id.data, ativo: false }, { requestId });
}

/** A jornada própria, se o membro ainda não tem uma publicada; senão `null`. */
async function jornadaSeMembroSemAgenda(
  admin: ReturnType<typeof createAdminClient>,
  org: string,
  userId: string,
  propria: unknown,
): Promise<unknown> {
  const { data } = await admin
    .from("attendant_availability")
    .select("schedule")
    .eq("organization_id", org)
    .eq("user_id", userId)
    .maybeSingle();
  const janelas = (data as { schedule: { windows?: unknown[] } | null } | null)?.schedule?.windows ?? [];
  return janelas.length > 0 ? null : propria;
}
