/**
 * POST /api/v1/ai/agents/:id/correcao/diagnosticar — "Corrigir com IA", passo 1.
 *
 * A pessoa relata o problema (e, se quiser, aponta a conversa em que ele
 * aconteceu). A IA lê o agente, os materiais, as últimas execuções e a
 * conversa — mascarada — e devolve as causas prováveis, com evidência, e até 3
 * perguntas quando a correção depende de uma decisão do dono.
 *
 * Não escreve nada. O contrato está em `lib/ai/agents/correcao/esquemas.ts`.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import { capacidadesPorPacote } from "@/lib/ai/agents/capacidades-padrao";
import { verificarPrompt } from "@/lib/ai/agents/construtor/verificacao";
import { carregarContextoDaCorrecao } from "@/lib/ai/agents/correcao/contexto";
import { entradaDoDiagnosticoSchema, saidaDoDiagnosticoSchema } from "@/lib/ai/agents/correcao/esquemas";
import { normalizarDiagnostico, pacotesLigados } from "@/lib/ai/agents/correcao/montar";
import { descreverContexto, descreverPedido, INSTRUCOES_DO_DIAGNOSTICO } from "@/lib/ai/agents/correcao/prompts";
import { createAdminClient } from "@/lib/supabase/admin";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { causaDe, portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PURPOSE = "agent_builder_corrigir";
const TOKENS = 4_000;
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = randomUUID();
  const { id: agentId } = await ctx.params;
  if (!UUID_RX.test(agentId)) return fail("invalid_request", "Agente inválido.", 400, { requestId });

  const authz = await requireRole("admin", { requestId, resource: "ai_agents" });
  if (!authz.ok) return authz.response;
  const orgId = authz.org.orgId;

  const lido = entradaDoDiagnosticoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Conte o problema que o agente está tendo.", 422, {
      requestId,
      details: lido.error.flatten(),
    });
  }
  const { problema, conversation_id, anexos, historico } = lido.data;

  const admin = createAdminClient();
  const contexto = await carregarContextoDaCorrecao(admin, orgId, agentId, { conversationId: conversation_id });
  if (!contexto.ok) return fail(contexto.code, contexto.message, contexto.status, { requestId });
  const c = contexto.contexto;

  const orcamento = await orcamentoPermite(orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, { requestId });
  }
  const cadeia = await resolverCadeia(PURPOSE, orgId, DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL);
  if (cadeia === null) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  const mapa = capacidadesPorPacote();
  const prompt = String(c.base.bruta.system_prompt ?? "");
  // A conferência do prompt de hoje: o modelo recebe o que ela achou como pista.
  const achados = verificarPrompt({
    prompt,
    fonte: prompt,
    pacotes: pacotesLigados(new Set((c.base.bruta.tool_ids as string[] | null) ?? []), mapa),
  });

  const t0 = Date.now();
  try {
    const porta = portaComFallback(cadeia, { organizationId: orgId, requestId });
    const resposta = await porta.objeto({
      schema: saidaDoDiagnosticoSchema,
      system: INSTRUCOES_DO_DIAGNOSTICO,
      prompt: [
        descreverContexto(c, mapa),
        achados.length === 0
          ? ""
          : `A CONFERÊNCIA AUTOMÁTICA DO PROMPT ACHOU:\n${achados.map((a) => `- [${a.nivel}] ${a.mensagem}`).join("\n")}\n`,
        descreverPedido(problema, historico, anexos),
      ].join("\n"),
      rotulo: "corrigir:diagnosticar",
      sinal: req.signal,
      maxOutputTokens: TOKENS,
    });
    if (!resposta.ok || resposta.objeto === undefined) {
      logger.error("agent_builder.corrigir.diagnosticar.falhou", {
        organizationId: orgId,
        requestId,
        ms: Date.now() - t0,
        causa: resposta.causa ?? "sem causa",
      });
      return fail("ai_provider_error", resposta.causa ?? "A IA não conseguiu analisar o agente. Tente de novo.", 502, {
        requestId,
      });
    }

    const diagnostico = normalizarDiagnostico(resposta.objeto);
    logger.info("agent_builder.corrigir.diagnosticar.fim", {
      requestId,
      ms: Date.now() - t0,
      hipoteses: diagnostico.hipoteses.length,
      perguntas: diagnostico.perguntas.length,
      comConversa: c.conversa !== null,
    });
    return ok(
      {
        diagnostico,
        base: { id: c.base.id, version_number: c.base.version_number, partiu_do_rascunho: c.partiuDoRascunho },
      },
      { requestId },
    );
  } catch (err) {
    logger.error("agent_builder.corrigir.diagnosticar.falhou", { organizationId: orgId, requestId, causa: causaDe(err) });
    return fail("ai_provider_error", "Não consegui analisar o agente. Tente de novo.", 502, { requestId });
  }
}
