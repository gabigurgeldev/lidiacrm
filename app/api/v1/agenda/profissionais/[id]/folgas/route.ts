/**
 * `/api/v1/agenda/profissionais/{id}/folgas` — as exceções por data de UMA
 * profissional (`calendar_availability_exceptions.professional_id`, migration 0245).
 *
 *   GET    → `Folga[]` `{ id, data, indisponivel, inicio_minuto, fim_minuto, motivo }`
 *   POST   `{ data, indisponivel?, inicio_minuto?, fim_minuto?, motivo? }` → 201 a folga
 *          409 `state_conflict` se já existe folga nesse dia começando no mesmo minuto
 *   DELETE `{ id }` → `{ id }`
 *
 * `inicio_minuto`/`fim_minuto` ausentes = o dia inteiro (gravado como 0..1440,
 * que colide como deve no índice único — ver a 0177) e devolvidos como `null`.
 *
 * Quem escreve: `manager`, ou a PRÓPRIA pessoa quando a profissional é ela
 * (`user_id` = quem está logado) — a mesma régua da policy de escrita da 0177.
 * Ler é `viewer`. Para quem tem login, o `user_id` vai gravado junto: é o que a
 * policy self-OU-manager+ lê.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { roleAtLeast } from "@/lib/auth/types";
import { createAdminClient } from "@/lib/supabase/admin";

import { linhaDaProfissional } from "../../_itens";
import { criarFolgaSchema, removerFolgaSchema } from "../../_schemas";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
type Ctx = { params: Promise<{ id: string }> };

interface LinhaDaFolga {
  id: string;
  exception_date: string;
  is_unavailable: boolean;
  start_minute: number;
  end_minute: number;
  reason: string | null;
}

const COLUNAS = "id, exception_date, is_unavailable, start_minute, end_minute, reason";

function folgaDe(l: LinhaDaFolga) {
  const diaInteiro = l.start_minute === 0 && l.end_minute === 1440;
  return {
    id: l.id,
    data: l.exception_date,
    indisponivel: l.is_unavailable,
    inicio_minuto: diaInteiro ? null : l.start_minute,
    fim_minuto: diaInteiro ? null : l.end_minute,
    motivo: l.reason,
  };
}

export async function GET(_req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "calendar_availability_exceptions" });
  if (!authz.ok) return authz.response;
  const org = authz.org.orgId;

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return fail("validation_failed", "Identificador inválido.", 422, { requestId });

  const admin = createAdminClient();
  try {
    const prof = await linhaDaProfissional(admin, org, id.data);
    if (!prof) return fail("not_found", "Profissional não encontrada.", 404, { requestId });

    const { data, error } = await admin
      .from("calendar_availability_exceptions")
      .select(COLUNAS)
      .eq("organization_id", org)
      .eq("professional_id", prof.id)
      .order("exception_date")
      .order("start_minute")
      .limit(500);
    if (error) return fail("internal_error", error.message, 500, { requestId });
    return ok(((data ?? []) as LinhaDaFolga[]).map(folgaDe), { requestId });
  } catch (err) {
    return fail("internal_error", (err as Error).message, 500, { requestId });
  }
}

export async function POST(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const autorizado = await autorizarEscrita(ctx, requestId);
  if (!autorizado.ok) return autorizado.response;
  const { org, prof, userId, admin } = autorizado;

  const lido = criarFolgaSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) {
    return fail("validation_failed", lido.error.issues[0]?.message ?? "Dados inválidos.", 422, {
      details: lido.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const f = lido.data;

  const { data, error } = await admin
    .from("calendar_availability_exceptions")
    .insert({
      organization_id: org,
      professional_id: prof.id,
      user_id: prof.user_id,
      exception_date: f.data,
      is_unavailable: f.indisponivel,
      start_minute: f.inicio_minuto ?? 0,
      end_minute: f.fim_minuto ?? 1440,
      reason: f.motivo ?? null,
    })
    .select(COLUNAS)
    .single();
  if (error) {
    if (error.code === "23505") {
      return fail("state_conflict", "Já existe uma folga nesse dia começando nesse horário.", 409, { requestId });
    }
    return fail("internal_error", error.message, 500, { requestId });
  }

  const folga = folgaDe(data as LinhaDaFolga);
  void audit({
    action: "agenda.folga_criada",
    actorUserId: userId,
    organizationId: org,
    resourceType: "calendar_availability_exception",
    resourceId: folga.id,
    requestId,
    metadata: {
      professional_id: prof.id,
      data: folga.data,
      indisponivel: folga.indisponivel,
      inicio_minuto: folga.inicio_minuto,
      fim_minuto: folga.fim_minuto,
    },
  });
  return ok(folga, { requestId, status: 201 });
}

export async function DELETE(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const autorizado = await autorizarEscrita(ctx, requestId);
  if (!autorizado.ok) return autorizado.response;
  const { org, prof, userId, admin } = autorizado;

  const lido = removerFolgaSchema.safeParse(await req.json().catch(() => null));
  if (!lido.success) return fail("validation_failed", "Informe o id da folga.", 422, { requestId });

  const { data, error } = await admin
    .from("calendar_availability_exceptions")
    .delete()
    .eq("organization_id", org)
    .eq("professional_id", prof.id)
    .eq("id", lido.data.id)
    .select("id, exception_date")
    .maybeSingle();
  if (error) return fail("internal_error", error.message, 500, { requestId });
  if (!data) return fail("not_found", "Folga não encontrada.", 404, { requestId });

  void audit({
    action: "agenda.folga_removida",
    actorUserId: userId,
    organizationId: org,
    resourceType: "calendar_availability_exception",
    resourceId: lido.data.id,
    requestId,
    metadata: { professional_id: prof.id, data: (data as { exception_date: string }).exception_date },
  });
  return ok({ id: lido.data.id }, { requestId });
}

/**
 * Papel mínimo `agent`, e então: `manager`, ou a própria pessoa vinculada.
 * A profissional é resolvida contra a organização do cookie — id de outra org
 * é 404, igual a inexistente.
 */
async function autorizarEscrita(
  ctx: Ctx,
  requestId: string,
): Promise<
  | { ok: false; response: Response }
  | {
      ok: true;
      org: string;
      userId: string;
      admin: ReturnType<typeof createAdminClient>;
      prof: { id: string; user_id: string | null };
    }
> {
  const authz = await requireRole("agent", { requestId, resource: "calendar_availability_exceptions" });
  if (!authz.ok) return { ok: false, response: authz.response };
  const org = authz.org.orgId;

  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) {
    return { ok: false, response: fail("validation_failed", "Identificador inválido.", 422, { requestId }) };
  }

  const admin = createAdminClient();
  let prof: { id: string; user_id: string | null } | null;
  try {
    prof = await linhaDaProfissional(admin, org, id.data);
  } catch (err) {
    return { ok: false, response: fail("internal_error", (err as Error).message, 500, { requestId }) };
  }
  if (!prof) {
    return { ok: false, response: fail("not_found", "Profissional não encontrada.", 404, { requestId }) };
  }

  const ehEla = prof.user_id !== null && prof.user_id === authz.user.id;
  if (!ehEla && !roleAtLeast(authz.org.role, "manager")) {
    return {
      ok: false,
      response: fail(
        "forbidden_role",
        "Só um gerente, ou a própria profissional, pode mexer nas folgas dela.",
        403,
        { requestId },
      ),
    };
  }
  return { ok: true, org, userId: authz.user.id, admin, prof };
}
