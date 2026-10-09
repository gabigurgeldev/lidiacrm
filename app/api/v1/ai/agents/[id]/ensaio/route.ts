/**
 * POST /api/v1/ai/agents/:id/ensaio — o agente responde de VERDADE, e nada sai.
 *
 * Roda o turno de produção (o mesmo handler e as mesmas dependências do
 * worker) sobre o FORMULÁRIO — salvo ou não — numa transação que é desfeita no
 * fim. Nada é enviado no WhatsApp e nada fica no CRM; o custo de IA é real e
 * fica registrado em `llm_calls` com o propósito prefixado `ensaio:`. O como e o
 * porquê estão em `lib/agent-engine/ensaio/ensaiar.ts`.
 *
 * `:id` é o agente em edição, ou `novo` para o formulário de criação.
 *
 * Substitui `/versions/:vid/test`, que ensaiava OUTRO motor (o runtime antigo):
 * outro prompt, sem as conferências de envio, e com as capacidades de escrita
 * mexendo no CRM real.
 */
import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";

import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { mensagemDoEscopo, validarEscopoDaVersao } from "@/lib/ai/agents/escopo";
import { versionCreateSchema } from "@/lib/ai/agents/validation";
import { montarDepsDoTurno } from "@/lib/agent-engine/agent/deps-do-turno";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { ensaiarTurno, EnsaioOcupadoError } from "@/lib/agent-engine/ensaio/ensaiar";
import { loadEnv } from "@/lib/agent-engine/env";
import { createLogger } from "@/lib/agent-engine/obs/logger";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
// Um turno real chama o modelo algumas vezes; o teto do turno é de 2 min.
export const maxDuration = 180;

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const pedidoSchema = z
  .object({
    versao: versionCreateSchema,
    conversa: z
      .array(
        z
          .object({
            de: z.enum(["cliente", "agente"]),
            texto: z.string().trim().min(1).max(4000),
          })
          .strict(),
      )
      .min(1)
      .max(40)
      .refine((c) => c.at(-1)?.de === "cliente", { message: "a última fala precisa ser do cliente" }),
    nome_do_contato: z.string().trim().max(120).optional(),
    /** ISO — "testar como se fosse este instante" (horário de funcionamento, janela). */
    agora: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id } = await ctx.params;
  const agentId = id === "novo" ? null : id;
  if (agentId !== null && !UUID_RX.test(agentId)) {
    return fail("invalid_request", "Agente inválido.", 400, { requestId });
  }

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org } = authz;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail("invalid_request", "Body JSON inválido.", 400, { requestId });
  }
  const parsed = pedidoSchema.safeParse(raw);
  if (!parsed.success) {
    return fail("validation_failed", "Campos inválidos.", 422, { requestId, details: parsed.error.flatten() });
  }

  const admin = createAdminClient();
  const v = parsed.data.versao;

  // O número e o escopo vêm do CORPO: o ensaio roda com eles (ritmo, saúde e
  // provedor do número; funis, materiais e integrações do agente), então cada
  // id tem de ser desta organização — a mesma conferência de quem salva.
  const { data: numero } = await admin
    .from("channel_sessions")
    .select("id")
    .eq("id", v.channel_session_id)
    .eq("organization_id", org.orgId)
    .maybeSingle();
  if (!numero) {
    return fail("validation_failed", "Escolha um número conectado desta organização.", 422, { requestId });
  }
  const escopo = await validarEscopoDaVersao(admin, org.orgId, {
    pipeline_ids: v.pipeline_ids,
    knowledge_source_ids: v.knowledge_source_ids,
    api_endpoint_ids: v.api_endpoint_ids,
  });
  if (!escopo.ok) {
    return fail("validation_failed", mensagemDoEscopo(escopo), 422, { requestId });
  }

  // O agente em edição é desta organização e não está arquivado. O id vem do
  // caminho, a organização da sessão — nunca do corpo.
  if (agentId !== null) {
    const { data: agente } = await admin
      .from("ai_agents")
      .select("id, archived_at")
      .eq("id", agentId)
      .eq("organization_id", org.orgId)
      .maybeSingle();
    if (!agente) return fail("not_found", "Agente não encontrado.", 404, { requestId });
    if (agente.archived_at) return fail("agent_archived", "Agente arquivado.", 409, { requestId });
  }

  let pool;
  let depsBase;
  try {
    pool = getRequestPool();
    depsBase = montarDepsDoTurno(loadEnv(), createLogger());
  } catch (err) {
    logger.error("[ai/ensaio] ambiente do motor indisponível", {
      requestId,
      causa: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return fail("unavailable", "O teste do agente não está disponível nesta instalação.", 503, { requestId });
  }

  try {
    const relatorio = await ensaiarTurno(pool, depsBase, {
      organizationId: org.orgId,
      agentId,
      versao: parsed.data.versao,
      conversa: parsed.data.conversa,
      ...(parsed.data.nome_do_contato !== undefined ? { nomeDoContato: parsed.data.nome_do_contato } : {}),
      ...(parsed.data.agora !== undefined ? { agora: new Date(parsed.data.agora) } : {}),
    });

    void audit({
      action: "ai_agent.tested",
      actorUserId: authUser.id,
      organizationId: org.orgId,
      resourceType: "ai_agent",
      resourceId: agentId ?? relatorio.id,
      requestId,
      metadata: {
        ensaio_id: relatorio.id,
        desfecho: relatorio.desfecho,
        chamadas: relatorio.custo.chamadas,
        custo_centavos: relatorio.custo.centavos,
      },
    });

    return ok(relatorio, { requestId });
  } catch (err) {
    if (err instanceof EnsaioOcupadoError) {
      return fail("state_conflict", err.message, 409, { requestId });
    }
    logger.error("[ai/ensaio] o ensaio falhou", {
      requestId,
      causa: (err instanceof Error ? err.message : String(err)).slice(0, 300),
    });
    return fail("internal_error", "O teste não pôde ser concluído.", 500, { requestId });
  }
}
