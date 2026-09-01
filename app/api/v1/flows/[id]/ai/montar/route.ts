/**
 * POST /api/v1/flows/[id]/ai/montar — ETAPA 2: preenche cada bloco do plano.
 *
 * ═══ ⚠️ ESTA ROTA ERA UM STREAM SSE, E DEIXOU DE SER ═══
 *
 * A versão anterior devolvia `text/event-stream`: esqueleto primeiro, cada bloco
 * "acendendo" no canvas quando o config dele ficava pronto, com heartbeat de 10s
 * para nenhum proxy cortar por ociosidade. Era bonito e não chegava ao usuário.
 *
 * MEDIDO, e o sintoma localiza a falha sozinho: numa VPS real a tela travava em
 * "Montando N blocos…" para sempre. Essa frase só é desenhada DEPOIS que a rota
 * irmã (`ai/plano`) respondeu — o `total` vem de `plano.blocos.length`. Ou seja,
 * o POST **JSON** da etapa 1 atravessava o proxy do cliente e funcionava; o que
 * morria era o stream, a única resposta `text/event-stream` do produto inteiro.
 *
 * Contra o provedor real (`pnpm ia:diagnostico`, OpenRouter), NENHUMA chamada ao
 * modelo falhava: plano em 11,0s e configs de `logic.wait`, `logic.if`,
 * `whatsapp.notify_user` e `crm.add_tag` entre 4,1 e 5,0s, todos 200 e
 * `finishReason: "stop"`. O defeito não estava no provedor nem no schema — os
 * dois lugares onde as quatro correções anteriores procuraram. Estava no
 * TRANSPORTE.
 *
 * O heartbeat não salvava porque ele só resolve teto de OCIOSIDADE. Contra um
 * proxy que bufferiza a resposta (o cliente não recebe evento nenhum e a barra
 * fica em 0) ou que tem teto de DURAÇÃO TOTAL, ele não faz nada. E o produto é
 * self-host: o proxy é de outra pessoa, e ninguém aqui o configura.
 *
 * Hoje é um POST JSON como qualquer outro. Decisão do dono do produto: a IA
 * monta e a pessoa confere depois, em vez de assistir.
 *
 * ═══ O que se GANHA junto ═══
 *
 * Falha volta a ser status HTTP com `details.causa`. Num stream, depois dos
 * cabeçalhos 200, nenhuma causa vira status: vira stream truncado, e o cliente
 * mostra a mesma frase genérica para tudo. Era a doença que esta frente inteira
 * veio curar, e o stream a reintroduzia pela porta dos fundos.
 *
 * ═══ O que se PERDE, dito por inteiro ═══
 *
 * O progresso ao vivo, e o teto de tempo passa a ser o da resposta. Com
 * `CONCORRENCIA_PADRAO = 4` e ~4,5s por config: 8 blocos ≈ 10s, 20 blocos ≈ 25s.
 * Folgado sob um teto de 60s; apertado sob um de 30s com fluxo grande. Por isso
 * o cliente NÃO desfaz o canvas quando esta rota falha — o esqueleto fica lá,
 * com valores padrão, e a pessoa preenche à mão. Ver `useGeracaoDeFluxo.ts`.
 *
 * ═══ O plano vem no corpo — e é revalidado ═══
 *
 * Não é buraco de tenancy: `organization_id` continua saindo de `requireRole`
 * (cookie/JWT), nunca do corpo. O plano é dado de CONTEÚDO, e é conferido
 * contra o Zod e contra o registry antes de qualquer uso — um `tipo` que não
 * existe é descartado, não executado.
 *
 * ═══ Sem escrita no banco ═══
 *
 * Devolve o grafo e nada mais. Quem persiste é o "Salvar rascunho" de sempre
 * (`PATCH /api/v1/flows/[id]`), igual a um fluxo montado à mão — nada de
 * caminho de gravação paralelo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { gerarConfigs } from "@/lib/flow-engine/ai/etapas";
import { portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";
import { montarSchemaDePlano, type PlanoDeFluxo } from "@/lib/flow-engine/ai/plan-schema";
import { planoParaGrafo, type ConfigResolvida } from "@/lib/flow-engine/ai/plan-to-graph";

export const dynamic = "force-dynamic";

/**
 * VALE NA VERCEL, NÃO NO SELF-HOST. Em `output: "standalone"` quem limita é o
 * proxy à frente — e, sem o heartbeat, agora é ele quem decide o teto de
 * verdade. Ver o parágrafo "o que se perde" no cabeçalho.
 */
export const maxDuration = 300;

const PURPOSE = "flow_ai_gerar";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id: flowId } = await ctx.params;

  const entradaSchema = z.strictObject({
    pedido: z.string().trim().min(1).max(2000),
    plano: montarSchemaDePlano(),
  });
  const lido = entradaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "O plano do fluxo veio inválido.", 422, { requestId });
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

  // O fluxo precisa ser DESTA organização antes de virar `resourceId` de uma
  // linha de auditoria. A rota antiga auditava o id que viesse no caminho, sem
  // conferir: não vazava dado (ela não lê o fluxo), mas sujava o
  // `api_audit_log` com id alheio — e audit log é append-only, então a sujeira
  // fica. Service role bypassa RLS: o filtro por organização é manual, de fonte
  // confiável (o cookie), nunca do corpo.
  const admin = createAdminClient();
  const { data: fluxo } = await admin
    .from("flows")
    .select("id")
    .eq("id", flowId)
    .eq("organization_id", authz.org.orgId)
    .maybeSingle();
  if (!fluxo) {
    return fail("not_found", "Fluxo não encontrado.", 404, { requestId });
  }

  const plano: PlanoDeFluxo = lido.data.plano;
  const t0 = Date.now();
  logger.info("flow.ai.montar.inicio", {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
    blocos: plano.blocos.length,
  });

  const porta = portaComFallback(cadeia, {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
  });

  try {
    // `req.signal` continua sendo passado: fechar a aba no meio da geração para
    // as chamadas em voo, e sem isso o provedor seguiria sendo pago por um
    // resultado que ninguém vai ler.
    const { configs, telemetria } = await gerarConfigs(porta, plano, lido.data.pedido, {
      sinal: req.signal,
    });

    const montado = planoParaGrafo(plano, configs as ReadonlyMap<string, ConfigResolvida>);

    if (!montado.valido) {
      logger.error("flow.ai.montar.grafo_invalido", {
        organizationId: authz.org.orgId,
        requestId,
        flowId,
        ms: Date.now() - t0,
        causa: montado.descartes.map((d) => `${d.o_que}: ${d.motivo}`).join(" | "),
        finishReason: telemetria.finishReasons,
        warnings: telemetria.warnings,
      });
      void audit({
        action: "flow.ai_generation_failed",
        actorUserId: authz.user.id,
        organizationId: authz.org.orgId,
        resourceType: "flow",
        resourceId: flowId,
        requestId,
        metadata: { onde: "montagem", descartes: montado.descartes.slice(0, 10) },
      });
      // 422 e não 502: o provedor respondeu: o que não deu foi o CONTEÚDO caber
      // no que este produto sabe montar. `details.causa` chega à tela e diz o
      // que foi descartado, em vez da frase genérica de antes.
      return fail(
        "ai_generation_empty",
        "Não sobrou nenhum bloco válido no plano. Tente descrever de outro jeito.",
        422,
        {
          requestId,
          details: { causa: montado.descartes.map((d) => `${d.o_que}: ${d.motivo}`).slice(0, 5) },
        },
      );
    }

    logger.info("flow.ai.montar.fim", {
      organizationId: authz.org.orgId,
      requestId,
      flowId,
      ms: Date.now() - t0,
      modeloCanonico: cadeia.primario.modelId,
      nos: montado.grafo.nodes.length,
      arestas: montado.grafo.edges.length,
      // Contagem separada de propósito: "montou" com metade dos blocos em
      // valores padrão é um resultado diferente de "montou", e um número que
      // sobe aqui acusa provedor recusando o formato de config.
      comExemplo: montado.comExemplo,
      descartes: montado.descartes.length,
      chamadas: telemetria.chamadas,
      // Agregado: um punhado de "length" acusa teto de tokens curto por config;
      // um "erro" repetido acusa provedor recusando o formato.
      finishReason: telemetria.finishReasons,
      warnings: telemetria.warnings,
    });
    void audit({
      action: "flow.ai_generated",
      actorUserId: authz.user.id,
      organizationId: authz.org.orgId,
      resourceType: "flow",
      resourceId: flowId,
      requestId,
      metadata: {
        nos: montado.grafo.nodes.length,
        arestas: montado.grafo.edges.length,
        comExemplo: montado.comExemplo,
        modelo: cadeia.primario.modelId,
      },
    });

    return ok(
      {
        grafo: montado.grafo,
        comExemplo: montado.comExemplo,
        descartes: montado.descartes,
      },
      { requestId },
    );
  } catch (err) {
    // Só chega aqui o inesperado: `gerarConfigs` não lança por bloco, e a
    // montagem é determinística. Ainda assim, sem este bloco um throw viraria
    // 500 sem uma linha em lugar nenhum — que é a doença que esta frente veio
    // curar.
    const causa = err instanceof Error ? err.message : String(err);
    logger.error("flow.ai.montar.estourou", {
      organizationId: authz.org.orgId,
      requestId,
      flowId,
      ms: Date.now() - t0,
      causa,
    });
    return fail("ai_provider_error", "A montagem falhou no meio. Tente de novo.", 502, {
      requestId,
      details: { causa },
    });
  }
}
