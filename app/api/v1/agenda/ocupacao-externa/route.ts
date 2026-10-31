/**
 * GET /api/v1/agenda/ocupacao-externa?de&ate — os blocos "Ocupado" que vêm do
 * Google, para a grade continuar desenhando-os depois da primeira pintura.
 *
 * A página (`app/app/agenda/page.tsx`) já os entregava no RSC, mas o refetch do
 * `useAgendamentos` trocava a lista inteira e os blocos sumiam — a pessoa via a
 * agenda "ocupado" por um segundo e vazia depois. Esta rota é o fio que faltava.
 *
 * ⚠️ O `title` NÃO É LIDO, pela mesma razão da página: o evento é da agenda
 * PESSOAL de alguém, e o que a equipe precisa saber é que o horário está tomado,
 * não o que a pessoa vai fazer nele. Guarda em
 * `tests/unit/ocupacao-do-google-nao-expoe-titulo.test.ts`.
 *
 * Client de SESSÃO: a RLS de `calendar_external_events` (0249) entrega ao
 * atendente só os eventos da PRÓPRIA conexão e à gerência os de todos — o mesmo
 * escopo da agenda. O `organization_id` vem do cookie validado e vai explícito.
 *
 * Read-only ⇒ sem audit. Piso `viewer`, como o resto da leitura da agenda.
 */
import { randomUUID } from "node:crypto";

import { type NextRequest } from "next/server";
import { z } from "zod";

import { MAXIMO_DE_DIAS } from "@/lib/agenda/consulta";
import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

const querySchema = z.object({
  de: z.string().datetime({ offset: true }),
  ate: z.string().datetime({ offset: true }),
});

export interface OcupacaoExterna {
  id: string;
  starts_at: string;
  ends_at: string;
  owner_user_id: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("viewer", { requestId, resource: "agenda" });
  if (!authz.ok) return authz.response;
  const { org: activeOrg } = authz;

  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    de: url.searchParams.get("de") ?? undefined,
    ate: url.searchParams.get("ate") ?? undefined,
  });
  if (!parsed.success) {
    return fail("validation_failed", "Consulta inválida.", 422, {
      details: parsed.error.flatten().fieldErrors as Record<string, unknown>,
      requestId,
    });
  }
  const de = new Date(parsed.data.de);
  const ate = new Date(parsed.data.ate);
  if (ate.getTime() <= de.getTime() || ate.getTime() - de.getTime() > MAXIMO_DE_DIAS * 86_400_000) {
    return fail("validation_failed", `Período inválido (até ${MAXIMO_DE_DIAS} dias).`, 422, { requestId });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_external_events")
    .select("id, starts_at, ends_at, calendar_connections!inner(user_id)")
    .eq("organization_id", activeOrg.orgId)
    .gte("starts_at", de.toISOString())
    .lt("starts_at", ate.toISOString())
    // `transparent` no Google é "livre": existe e não ocupa.
    .neq("transparency", "transparent")
    .neq("status", "cancelled")
    .order("starts_at")
    .limit(500);
  if (error) return fail("internal_error", error.message, 500, { requestId });

  const blocos: OcupacaoExterna[] = (data ?? []).map((e) => {
    const conexao = e.calendar_connections as { user_id: string } | { user_id: string }[] | null;
    const dono = Array.isArray(conexao) ? conexao[0]?.user_id : conexao?.user_id;
    return { id: String(e.id), starts_at: String(e.starts_at), ends_at: String(e.ends_at), owner_user_id: dono ?? null };
  });

  return ok(blocos, { requestId });
}
