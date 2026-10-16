/**
 * POST /api/v1/attendants/heartbeat — "ainda estou aqui" do atendente online.
 *
 * O cron `attendant-heartbeat` derruba quem não pinga há 15 min, e a rota PATCH
 * dizia que um `useHeartbeat` do inbox pingava a cada 60 s. Esse hook nunca
 * existiu: medido em produção (2026-10-16), quem ligava "Disponível" voltava a
 * offline em até 20 min, e com o rodízio ligado ninguém era elegível.
 *
 * Só ATUALIZA o carimbo de vida de quem JÁ está online — nunca liga ninguém.
 * Ligar continua sendo ato explícito (a chave da tela Equipe, via PATCH), e um
 * atendente que se pôs offline não volta a online por ter a aba aberta.
 *
 * Por que não passa pelo PATCH: o PATCH audita, e com um ping por minuto por
 * pessoa o audit log (append-only, retenção de anos) viraria batida de relógio —
 * o mesmo afogamento que a doutrina já mediu nos crons (95% do log). Aqui não há
 * decisão de ninguém para registrar: ligar e desligar são auditados onde
 * acontecem (PATCH e a varredura do cron).
 *
 * org de fonte confiável (activeOrg do cookie), user = o próprio autenticado; o
 * client é o do usuário, então a RLS de attendant_availability é o backstop.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const authz = await requireRole("agent", { requestId, resource: "attendant_availability" });
  if (!authz.ok) return authz.response;
  const { user, org } = authz;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendant_availability")
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq("organization_id", org.orgId)
    .eq("user_id", user.id)
    .eq("is_available", true)
    .select("user_id");

  if (error) return fail("internal_error", error.message, 500, { requestId });

  return ok({ online: (data ?? []).length > 0 }, { requestId });
}
