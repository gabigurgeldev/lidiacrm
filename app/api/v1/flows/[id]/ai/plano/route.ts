/**
 * POST /api/v1/flows/[id]/ai/plano — ETAPA 1: quais blocos, em que ordem.
 *
 * ═══ Por que esta rota é síncrona ═══
 *
 * Aqui é onde as falhas moram: provedor fora do ar, orçamento estourado, schema
 * recusado, id de modelo que não existe no catálogo. Todas acontecem ANTES de
 * qualquer byte de resposta, então todas podem virar status HTTP com
 * `details.causa` — que é o `fail()` de sempre, renderizado pelo `apiClient`
 * como frase legível na tela.
 *
 * O caminho anterior fazia o oposto: abria um stream e só então chamava o
 * modelo. Depois dos cabeçalhos 200, erro nenhum vira status; vira stream
 * truncado, e o SDK o engole. A pessoa recebia "A IA não conseguiu terminar o
 * fluxo" para qualquer causa — inclusive para "não há provedor configurado",
 * que tem conserto de um clique.
 *
 * ⚠️ ESTE PARÁGRAFO DIZIA "e a irmã (`montar`) é stream". NÃO DIZ MAIS: a rota
 * de montagem deixou de ser SSE, pelo motivo escrito no cabeçalho dela — o
 * stream não atravessava o proxy da VPS, e a tela travava em "Montando N
 * blocos…" para sempre. Hoje as duas são JSON, e esta continua sendo a que
 * responde primeiro justamente porque é curta (~11s medidos).
 *
 * ═══ Sem escrita no banco ═══
 *
 * Esta rota devolve um plano e nada mais. Não grava `flows.draft_graph`, não
 * cria nó, não audita: não há mutação para auditar. Quem persiste continua
 * sendo o "Salvar rascunho" de sempre.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { logger } from "@/lib/logger";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { motivoDaEntradaRecusada } from "@/lib/flow-engine/ai/entrada";
import { portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";
import {
  TOKENS_DO_PLANO,
  montarSchemaDePlano,
  type PlanoDeFluxo,
} from "@/lib/flow-engine/ai/plan-schema";
import { promptDePlano, promptDoUsuario } from "@/lib/flow-engine/ai/prompt";

export const dynamic = "force-dynamic";

/**
 * VALE NA VERCEL, NÃO NO SELF-HOST — mesma ressalva das rotas irmãs. Em
 * `output: "standalone"` quem limita o tempo é o proxy à frente, não esta linha.
 */
export const maxDuration = 120;

const PURPOSE = "flow_ai_gerar";

export const entradaDeGeracaoSchema = z.strictObject({
  pedido: z.string().trim().min(1).max(2000),
  historico: z
    .array(
      z.strictObject({
        papel: z.enum(["usuario", "ia"]),
        texto: z.string().max(2000),
      }),
    )
    .max(20)
    .default([]),
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
  const lido = entradaDeGeracaoSchema.safeParse(corpo);
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

  const t0 = Date.now();
  logger.info("flow.ai.plano.inicio", {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
    // Canônico, NÃO o id enviado ao provedor — a tradução para o nome da
    // OpenRouter acontece dentro do provider (ver idNaOpenRouter).
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
    temReserva: cadeia.reserva !== null,
  });

  const porta = portaComFallback(cadeia, {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
  });

  const resultado = await porta.objeto<PlanoDeFluxo>({
    schema: montarSchemaDePlano(),
    system: promptDePlano(),
    prompt: promptDoUsuario(lido.data.pedido, lido.data.historico),
    // ⚠️ ERA `1200`, COM UM COMENTÁRIO DIZENDO "folgado para 40 blocos".
    //
    // Medido contra o provedor real: o pedido de exemplo (8 blocos) gastava
    // entre 826 e 1166 — raspando —, e um pedido de tamanho normal (15 blocos)
    // foi CORTADO em 4 de 4 rodadas. O corte chega como
    // "could not parse the response", que fala de parse, e foi o que fez cinco
    // correções procurarem no schema, no provedor e no transporte.
    //
    // O número agora mora junto de `MAX_BLOCOS`/`MAX_LIGACOES`, que são o que
    // ele precisa comportar, e não é mais a última palavra: a porta sobe o teto
    // uma vez quando a resposta volta cortada.
    maxOutputTokens: TOKENS_DO_PLANO,
    rotulo: "plano",
    sinal: req.signal,
  });

  if (!resultado.ok || !resultado.objeto) {
    logger.error("flow.ai.plano.falhou", {
      organizationId: authz.org.orgId,
      requestId,
      flowId,
      ms: Date.now() - t0,
      modeloCanonico: resultado.modeloUsado,
      causa: resultado.causa ?? "objeto ausente",
      finishReason: resultado.finishReason,
      warnings: resultado.avisos,
      usouReserva: resultado.usouReserva,
    });
    // "Cortada mesmo com o teto dobrado" e "o modelo recusou" pedem coisas
    // DIFERENTES de quem está na tela: a primeira pede um pedido menor, a
    // segunda pede outra descrição. Mandar as duas para a mesma frase é o que
    // fazia a pessoa tentar de novo, igual, para receber o mesmo erro.
    const cortado = resultado.finishReason === "length";
    return fail(
      "ai_provider_error",
      cortado
        ? "O fluxo que você descreveu é grande demais para a IA montar de uma vez. Descreva uma parte por vez — o resto você liga à mão no quadro."
        : "A IA não conseguiu planejar o fluxo. Veja o detalhe abaixo ou tente descrever de outro jeito.",
      502,
      { requestId, details: { causa: resultado.causa ?? "objeto ausente" } },
    );
  }

  logger.info("flow.ai.plano.fim", {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
    ms: Date.now() - t0,
    modeloCanonico: resultado.modeloUsado,
    usouReserva: resultado.usouReserva,
    blocos: resultado.objeto.blocos.length,
    ligacoes: resultado.objeto.ligacoes.length,
    finishReason: resultado.finishReason,
    warnings: resultado.avisos,
    tokens_entrada: resultado.tokensEntrada,
    tokens_saida: resultado.tokensSaida,
  });

  return ok(resultado.objeto, { requestId });
}
