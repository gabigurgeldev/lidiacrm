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
import { requireRole } from "@/lib/auth/require-role";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { promptDeInterpretacao, promptDoUsuario } from "@/lib/flow-engine/ai/prompt";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";

export const dynamic = "force-dynamic";

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
    return ok(gerado.object, { requestId });
  } catch (err) {
    return fail(
      "ai_provider_error",
      "Não consegui entender o pedido. Tente descrever de outro jeito.",
      502,
      { requestId, details: { causa: err instanceof Error ? err.message : String(err) } },
    );
  }
}
