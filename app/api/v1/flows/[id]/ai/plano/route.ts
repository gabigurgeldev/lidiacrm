/**
 * POST /api/v1/flows/[id]/ai/plano — ETAPA 1: quais blocos, em que ordem.
 *
 * ═══ Por que esta rota é síncrona, e a irmã (`montar`) é stream ═══
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
import { portaComFallback, resolverCadeia } from "@/lib/flow-engine/ai/modelo-com-fallback";
import { montarSchemaDePlano, type PlanoDeFluxo } from "@/lib/flow-engine/ai/plan-schema";
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

  const lido = entradaDeGeracaoSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Descreva o que você quer antes de gerar.", 422, { requestId });
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
    // O plano é uma lista de rótulos e frases curtas: 1200 é folgado para 40
    // blocos e continua LONGE do teto, o que devolve sinal a
    // `finishReason: "length"` — no caminho antigo, com 4000 para um grafo
    // inteiro, "length" era o estado normal e não acusava nada.
    maxOutputTokens: 1200,
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
    return fail(
      "ai_provider_error",
      "A IA não conseguiu planejar o fluxo. Veja o detalhe abaixo ou tente descrever de outro jeito.",
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
