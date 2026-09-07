/**
 * POST /api/v1/flows/[id]/ai/ajustar — mexer num fluxo que já existe.
 *
 * ═══ Por que não é a rota de montar com outro nome ═══
 *
 * `plano` + `montar` criam do zero: a etapa 1 nunca vê o quadro, e a etapa 2
 * gera a config de TODOS os blocos. Aplicado a um fluxo existente, isso
 * devolveria um fluxo novo por fora parecido e por dentro diferente — sem o
 * texto que a pessoa escreveu no editor, sem o canal que ela escolheu, sem os
 * minutos que ela corrigiu à mão.
 *
 * Aqui o grafo atual entra como plano (`grafo-para-plano.ts`), o modelo devolve
 * o plano ajustado, e só os blocos NOVOS ou com intenção diferente passam pela
 * etapa 2 (`ajuste.ts`). Bloco intocado mantém a config que estava no quadro.
 *
 * ═══ Uma chamada de plano, e só as configs necessárias ═══
 *
 * "Troca a espera para uma hora" num fluxo de 12 blocos custa 1 chamada de
 * plano + 1 de config. A montagem do zero custaria 1 + 12.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { dividirOAjuste, juntarConfigs } from "@/lib/flow-engine/ai/ajuste";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { motivoDaEntradaRecusada } from "@/lib/flow-engine/ai/entrada";
import { gerarConfigs } from "@/lib/flow-engine/ai/etapas";
import { grafoParaPlano } from "@/lib/flow-engine/ai/grafo-para-plano";
import { portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";
import {
  TOKENS_DO_PLANO,
  montarSchemaDePlano,
  type PlanoDeFluxo,
} from "@/lib/flow-engine/ai/plan-schema";
import { planoParaGrafo, type ConfigResolvida } from "@/lib/flow-engine/ai/plan-to-graph";
import { planoComoTexto, promptDeAjuste } from "@/lib/flow-engine/ai/prompt";
import { tornarPublicavel } from "@/lib/flow-engine/ai/publicavel";
import { flowGraphSchema } from "@/lib/flow-engine/graph-schema";

export const dynamic = "force-dynamic";

/** Mesma ressalva das rotas irmãs: vale na Vercel, não no self-host. */
export const maxDuration = 300;

const PURPOSE = "flow_ai_gerar";

const entradaSchema = z.strictObject({
  pedido: z.string().trim().min(1).max(2000),
  grafo: flowGraphSchema,
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id: flowId } = await ctx.params;

  const corpo = await req.json().catch(() => ({}));
  const lido = entradaSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", motivoDaEntradaRecusada(lido.error, corpo), 422, { requestId });
  }

  const orcamento = await orcamentoPermite(authz.org.orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, {
      requestId,
    });
  }

  const cadeia = await resolverCadeia(PURPOSE, authz.org.orgId);
  if (cadeia === null) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  // Service role bypassa RLS: o filtro por organização é manual, de fonte
  // confiável (o cookie), nunca do corpo. Mesma checagem que `montar` faz —
  // e pelo mesmo motivo: o id vira `resourceId` de uma linha de auditoria, e
  // audit log é append-only, então id alheio ali fica.
  const admin = createAdminClient();
  const { data: fluxo } = await admin
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!fluxo) return fail("not_found", "Fluxo não encontrado.", 404, { requestId });

  const t0 = Date.now();
  const atual = grafoParaPlano(lido.data.grafo);
  logger.info("flow.ai.ajustar.inicio", {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
    blocos: atual.plano.blocos.length,
  });

  const porta = portaComFallback(cadeia, {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
  });

  try {
    const resposta = await porta.objeto<PlanoDeFluxo>({
      schema: montarSchemaDePlano(),
      system: promptDeAjuste(),
      prompt: `Fluxo atual:\n${planoComoTexto(atual.plano)}\n\nAlteração pedida: ${lido.data.pedido}`,
      maxOutputTokens: TOKENS_DO_PLANO,
      rotulo: "ajuste",
      sinal: req.signal,
    });

    if (!resposta.ok || resposta.objeto === undefined) {
      logger.error("flow.ai.ajustar.falhou", {
        organizationId: authz.org.orgId,
        requestId,
        flowId,
        ms: Date.now() - t0,
        modeloCanonico: resposta.modeloUsado,
        causa: resposta.causa ?? "objeto ausente",
        finishReason: resposta.finishReason,
        warnings: resposta.avisos,
      });
      return fail(
        "ai_provider_error",
        resposta.finishReason === "length"
          ? "O fluxo é grande demais para a IA reescrever de uma vez. Ajuste uma parte por vez."
          : "A IA não conseguiu aplicar o ajuste. Veja o detalhe abaixo ou peça de outro jeito.",
        502,
        { requestId, details: { causa: resposta.causa ?? "objeto ausente" } },
      );
    }

    // ── o que mudou paga; o que não mudou fica ────────────────────────────
    const divisao = dividirOAjuste(resposta.objeto, atual.configPorId, atual.intencaoPorId);
    const { configs, telemetria } =
      divisao.aGerar.blocos.length === 0
        ? { configs: new Map<string, ConfigResolvida>(), telemetria: null }
        : await gerarConfigs(porta, divisao.aGerar, lido.data.pedido, { sinal: req.signal });

    const todas = juntarConfigs(divisao.preservadas, configs as ReadonlyMap<string, ConfigResolvida>);
    const montado = planoParaGrafo(resposta.objeto, todas);

    if (!montado.valido) {
      logger.error("flow.ai.ajustar.grafo_invalido", {
        organizationId: authz.org.orgId,
        requestId,
        flowId,
        ms: Date.now() - t0,
        causa: montado.descartes.map((d) => `${d.o_que}: ${d.motivo}`).join(" | "),
      });
      void audit({
        action: "flow.ai_generation_failed",
        actorUserId: authz.user.id,
        organizationId: authz.org.orgId,
        resourceType: "flow",
        resourceId: flowId,
        requestId,
        metadata: { onde: "ajuste", descartes: montado.descartes.slice(0, 10) },
      });
      return fail(
        "ai_generation_empty",
        "O ajuste não produziu um fluxo válido. Tente pedir de outro jeito.",
        422,
        {
          requestId,
          details: { causa: montado.descartes.map((d) => `${d.o_que}: ${d.motivo}`).slice(0, 5) },
        },
      );
    }

    const publicavel = await tornarPublicavel({
      porta,
      plano: resposta.objeto,
      configs: todas,
      grafo: montado.grafo,
      sinal: req.signal,
    });

    logger.info("flow.ai.ajustar.fim", {
      organizationId: authz.org.orgId,
      requestId,
      flowId,
      ms: Date.now() - t0,
      modeloCanonico: resposta.modeloUsado,
      nos: publicavel.grafo.nodes.length,
      arestas: publicavel.grafo.edges.length,
      // O número que prova que isto é ajuste e não reescrita: quantos blocos
      // atravessaram sem pagar chamada nem perder o que a pessoa tinha posto.
      preservados: divisao.idsPreservados.length,
      regerados: divisao.aGerar.blocos.length,
      comExemplo: montado.comExemplo,
      consertosAutomaticos: publicavel.consertos.length,
      corrigidoPeloModelo: publicavel.corrigidoPeloModelo,
      pendencias: publicavel.pendencias.map((p) => p.codigo),
      finishReason: resposta.finishReason,
      warnings: [...resposta.avisos, ...(telemetria?.warnings ?? [])],
    });

    void audit({
      action: "flow.ai_generated",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "flow",
      resourceId: flowId,
      requestId,
      metadata: {
        onde: "ajuste",
        nos: publicavel.grafo.nodes.length,
        preservados: divisao.idsPreservados.length,
        regerados: divisao.aGerar.blocos.length,
        modelo: cadeia.primario.modelId,
      },
    });

    return ok(
      {
        grafo: publicavel.grafo,
        comExemplo: montado.comExemplo,
        descartes: montado.descartes,
        consertos: publicavel.consertos,
        pendencias: publicavel.pendencias,
        preservados: divisao.idsPreservados.length,
        regerados: divisao.aGerar.blocos.length,
      },
      { requestId },
    );
  } catch (err) {
    const causa = err instanceof Error ? err.message : String(err);
    logger.error("flow.ai.ajustar.estourou", {
      organizationId: authz.org.orgId,
      requestId,
      flowId,
      ms: Date.now() - t0,
      causa,
    });
    return fail("ai_provider_error", "O ajuste falhou no meio. Tente de novo.", 502, {
      requestId,
      details: { causa },
    });
  }
}
