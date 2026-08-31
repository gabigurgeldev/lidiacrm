/**
 * POST /api/v1/flows/[id]/ai/gerar — monta o grafo, em streaming de verdade.
 *
 * ═══ Por que streaming, e por que `streamObject` ═══
 *
 * É o primeiro streaming do produto (todo o resto do repo é síncrono — nem o
 * chat nem o teste de agente têm precedente de token-a-token). A escolha caiu
 * sobre `streamObject().toTextStreamResponse()` porque é exatamente o par que
 * `useObject` (`@ai-sdk/react`) do cliente consome sem nenhum parsing de SSE
 * escrito à mão — o hook já sabe montar o objeto parcial a partir do texto que
 * chega.
 *
 * `streamObject` está marcado `@deprecated` na tipagem do pacote `ai` em favor
 * de `streamText` com a opção `output` — mas continua funcional na versão
 * instalada (`ai@^7.0.69`) e é o par documentado de `useObject`. Migrar para
 * `streamText`+`output` fica como frente própria se o SDK remover
 * `streamObject` num major futuro; não há benefício hoje que justifique o
 * risco de trocar o único caminho de streaming do produto sem necessidade.
 *
 * ═══ Erros ANTES do stream abrir chegam como JSON comum ═══
 *
 * Org sem crédito, sem provedor configurado, corpo inválido: tudo isso é
 * conhecido ANTES de chamar o modelo, então volta pelo `fail()` de sempre —
 * só a partir do `streamObject` a resposta vira texto de stream.
 *
 * ═══ Sem escrita no banco ═══
 *
 * Esta rota NUNCA grava `flows.draft_graph`. Ela só devolve o grafo; quem
 * persiste é o clique em "Salvar rascunho" de sempre
 * (`PATCH /api/v1/flows/[id]`), exatamente como um fluxo montado à mão — nada
 * de caminho de gravação paralelo (mesma doutrina de `montarQuadro.ts` no
 * onboarding: "o que se grava é o que a pessoa está vendo").
 */
import { randomUUID } from "node:crypto";
import { streamObject } from "ai";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { DEFAULT_CLASSIFIER_MODEL } from "@/lib/ai/gateway";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { montarSchemaDeGeracao } from "@/lib/flow-engine/ai/generation-schema";
import { promptDeGeracao, promptDoUsuario } from "@/lib/flow-engine/ai/prompt";

export const dynamic = "force-dynamic";

const PURPOSE = "flow_ai_gerar";

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

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("manager", { requestId, resource: "flows" });
  if (!authz.ok) return authz.response;
  const { id: flowId } = await ctx.params;

  const lido = entradaSchema.safeParse(await req.json().catch(() => ({})));
  if (!lido.success) {
    return fail("validation_failed", "Descreva o que você quer antes de gerar.", 422, { requestId });
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

  const resultado = streamObject({
    model: resolvido.model,
    schema: montarSchemaDeGeracao(),
    system: promptDeGeracao(),
    prompt: promptDoUsuario(lido.data.pedido, lido.data.historico),
    temperature: 0.2,
    // Um fluxo cabe em até 60 nós (teto do schema); 4000 é folgado para isso
    // sem virar cheque em branco — a lição de `ai-sentiment-worker.ts` é que
    // pouco tokens trunca o JSON no meio, não que muito tokens seja de graça.
    maxOutputTokens: 4000,
    onFinish: ({ object, error, usage }) => {
      // Fire-and-forget, fora do caminho de resposta: o stream já foi
      // entregue ao cliente independente deste bloco. Falha aqui não pode
      // derrubar a geração que a pessoa já está vendo terminar.
      if (error || !object) {
        void audit({
          action: "flow.ai_generation_failed",
          actorUserId: authz.user.id,
          organizationId: authz.org.orgId,
          resourceType: "flow",
          resourceId: flowId,
          requestId,
          metadata: { causa: error instanceof Error ? error.message : String(error) },
        });
        return;
      }
      void audit({
        action: "flow.ai_generated",
        actorUserId: authz.user.id,
        organizationId: authz.org.orgId,
        resourceType: "flow",
        resourceId: flowId,
        requestId,
        metadata: {
          nos: object.nodes.length,
          arestas: object.edges.length,
          modelo: resolvido.modelId,
          tokens_entrada: usage.inputTokens ?? null,
          tokens_saida: usage.outputTokens ?? null,
        },
      });
    },
  });

  return resultado.toTextStreamResponse();
}
