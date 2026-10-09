/**
 * GET /api/v1/ai/agents/:id/consumo?days=30 — quanto este agente gastou por
 * atendimento, para o dono calibrar os limites (`lib/ai/agents/consumo-por-atendimento.ts`).
 *
 * Devolve o gasto de CADA atendimento (tokens novos e centavos de dólar), não só
 * o resumo: a tela recalcula "quantos o limite teria cortado" enquanto o dono
 * digita, sem uma ida ao servidor por tecla.
 *
 * Lê `llm_calls.agent_id`, que o motor grava a partir desta versão. Instalação
 * que acabou de atualizar não tem histórico ainda, e a tela diz isso em vez de
 * mostrar zeros.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { agruparPorAtendimento, type LinhaDeChamada } from "@/lib/ai/agents/consumo-por-atendimento";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Teto de linhas lidas: o bastante para um mês de um agente movimentado, sem varrer a tabela. */
const MAX_CHAMADAS = 20_000;

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  if (!UUID_RX.test(id)) return fail("invalid_request", "id inválido.", 400, { requestId });

  const authz = await requireRole("manager", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const { org } = authz;

  const parsed = querySchema.safeParse({ days: req.nextUrl.searchParams.get("days") ?? undefined });
  if (!parsed.success) {
    return fail("validation_failed", "Janela inválida.", 422, { requestId, details: parsed.error.flatten() });
  }
  const janelaEmDias = parsed.data.days;
  const desde = new Date(Date.now() - janelaEmDias * 86_400_000).toISOString();

  const admin = createAdminClient();
  const { data: agente } = await admin
    .from("ai_agents")
    .select("id")
    .eq("organization_id", org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!agente) return fail("not_found", "Agente não encontrado.", 404, { requestId });

  // Só o laço do agente (`agent_turn`), que é o que o limite corta. Ensaios ficam
  // fora sozinhos: o purpose deles é `ensaio:agent_turn`, e o agent_id é nulo.
  const { data: linhas, error } = await admin
    .from("llm_calls")
    .select("job_id, input_tokens, cache_read_tokens, output_tokens, cost_cents")
    .eq("organization_id", org.orgId)
    .eq("agent_id", id)
    .eq("purpose", "agent_turn")
    .eq("status", "ok")
    .gte("created_at", desde)
    .order("created_at", { ascending: false })
    .limit(MAX_CHAMADAS);
  if (error) return fail("internal_error", "Erro ao ler o consumo do agente.", 500, { requestId });

  const atendimentos = agruparPorAtendimento((linhas ?? []) as LinhaDeChamada[]);
  return ok(
    { janela_em_dias: janelaEmDias, atendimentos, truncado: (linhas ?? []).length >= MAX_CHAMADAS },
    { requestId },
  );
}
