/**
 * POST /api/v1/flows/[id]/ai/interpretar — a IA decide se precisa perguntar.
 *
 * Chamada não-streaming, rápida e barata: lê o pedido (mais o histórico da
 * conversa, se já houve idas e vindas) e devolve OU uma pergunta de múltipla
 * escolha, OU o sinal de que já pode montar. Quem monta de verdade é a Rota B
 * (`ai/gerar`), em streaming — esta rota nunca toca o grafo nem o banco do
 * fluxo.
 *
 * `[id]` do fluxo entra na assinatura por consistência com as demais rotas de
 * `/api/v1/flows/[id]/*`, mas esta rota não lê nem escreve a linha do fluxo —
 * a geração não depende do estado atual do grafo (a pessoa está pedindo para
 * CRIAR, não editar um nó existente).
 */
import { randomUUID } from "node:crypto";
import { generateObject } from "ai";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { promptDeInterpretacao, promptDoUsuario } from "@/lib/flow-engine/ai/prompt";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";

/**
 * A rota fala com um provedor de IA, e o cabeçalho acima chamá-la de "rápida e
 * barata" mede o TAMANHO do trabalho, não o tempo de resposta de terceiro. Sem
 * este teto, o padrão do runtime corta a chamada muito antes de um provedor
 * lento terminar, e a conexão morre sem que nada seja escrito — que é
 * exatamente a forma de um 502 sem uma linha de log.
 */
export const maxDuration = 120;

const PURPOSE = "flow_ai_interpretar";

const entradaSchema = z.strictObject({
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

const saidaSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("perguntar"),
    pergunta: z.string().min(1).max(300).describe("Uma pergunta objetiva, em português."),
    opcoes: z.array(z.string().min(1).max(80)).min(2).max(5),
  }),
  z.object({
    kind: z.literal("pronto"),
    resumo: z
      .string()
      .min(1)
      .max(400)
      .describe("Resumo do plano em 1-2 frases, para a pessoa confirmar."),
  }),
]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  await ctx.params; // valida a forma da rota; ver o cabeçalho sobre o [id] não ser usado.

  const lido = entradaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Descreva o que você quer antes de continuar.", 422, {
      requestId,
    });
  }

  const orcamento = await orcamentoPermite(authz.org.orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, {
      requestId,
    });
  }

  const resolvido = await resolverModeloDoPonto(PURPOSE, authz.org.orgId, DEFAULT_CLASSIFIER_MODEL);
  if (!resolvido) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  // Os dois logs abaixo existem porque a ausência deles custou três idas e
  // vindas com quem estava na tela: a chamada falhava com 502, o contêiner não
  // reiniciava, e o log do app não tinha UMA linha sobre esta rota — não dava
  // para distinguir "o provedor demorou" de "o pedido nunca chegou aqui".
  //
  // Com eles, a diferença fica legível no `docker logs`: só o `inicio` significa
  // que a resposta morreu no caminho (proxy ou teto de tempo); `inicio` +
  // `fim` com `ms` alto significa que o provedor é o lento.
  const t0 = Date.now();
  logger.info("flow.ai.interpretar.inicio", {
    organizationId: authz.org.orgId,
    requestId,
    modelo: resolvido.modelId,
  });

  try {
    const gerado = await generateObject({
      model: resolvido.model,
      schema: saidaSchema,
      system: promptDeInterpretacao(),
      prompt: promptDoUsuario(lido.data.pedido, lido.data.historico),
      temperature: 0.2,
      // Uma pergunta + opções, ou um resumo curto — nenhum dos dois precisa
      // de espaço. Baixo de propósito: a lição medida em
      // workers/ai-sentiment-worker.ts é que pouco tokens trunca o JSON no
      // meio; 400 é folgado para o teto de 300/400 caracteres dos campos.
      maxOutputTokens: 600,
    });
    logger.info("flow.ai.interpretar.fim", { requestId, ms: Date.now() - t0 });
    return ok(gerado.object, { requestId });
  } catch (err) {
    // A causa vai para o LOG além da resposta: `details` só chega a quem abriu
    // o DevTools, e a pessoa que reporta o problema raramente é essa.
    logger.error("flow.ai.interpretar.falhou", {
      organizationId: authz.org.orgId,
      requestId,
      ms: Date.now() - t0,
      modelo: resolvido.modelId,
      causa: err instanceof Error ? err.message : String(err),
    });
    return fail(
      "ai_provider_error",
      "Não consegui entender o pedido. Tente descrever de outro jeito.",
      502,
      { requestId, details: { causa: err instanceof Error ? err.message : String(err) } },
    );
  }
}
