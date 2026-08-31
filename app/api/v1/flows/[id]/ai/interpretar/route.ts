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
 * VALE NA VERCEL, NÃO NO SELF-HOST — e a diferença já enganou uma investigação.
 *
 * `maxDuration` é semântica de função serverless. `next.config.ts` usa
 * `output: "standalone"` fora da Vercel, e ali o processo é um servidor Node
 * comum: quem limita o tempo é o proxy à frente (`Caddyfile`), não esta linha.
 * Ela fica porque a rota TAMBÉM roda na Vercel, mas não conte com ela para
 * diagnosticar corte de tempo em VPS — lá o número que importa é o do Caddy.
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

/**
 * OBJETO NA RAIZ, NUNCA UNIÃO — e isto não é preferência de estilo.
 *
 * Este schema era `z.discriminatedUnion("kind", [...])`, que vira `anyOf` no
 * TOPO do JSON Schema. Structured Outputs de APIs compatíveis com OpenAI — que
 * é o que a OpenRouter expõe, e a OpenRouter é o caminho recomendado do
 * self-host — não aceitam `anyOf` no nível raiz. O resultado era "Criar fluxo
 * com IA" quebrado do primeiro dia, para todo mundo, sem exceção.
 *
 * O sintoma dependia do modelo e nenhuma das duas frases apontava para o
 * schema, que é a razão de o defeito ter sobrevivido a duas correções erradas:
 *
 *   anthropic/claude-haiku-4-5     "could not parse the response"    ~6s
 *   google/gemini-2.5-flash-lite   "response did not match schema"   ~1s
 *
 * A união aninhada continua permitida — `ai/gerar` usa uma dentro de `nodes`
 * (lib/flow-engine/ai/generation-schema.ts) e sempre funcionou. A proibição é
 * só da raiz.
 *
 * O preço de achatar é que o schema deixa de garantir a coerência por tipo:
 * `perguntar` sem `pergunta` passa a ser representável. Quem garante agora é
 * `coerente()`, logo abaixo — a validação mudou de lugar, não desapareceu.
 */
const saidaSchema = z.object({
  kind: z
    .enum(["perguntar", "pronto"])
    .describe(
      "'perguntar' se ainda falta informação para montar o fluxo; 'pronto' se já dá para montar.",
    ),
  pergunta: z
    .string()
    .max(300)
    .optional()
    .describe("Obrigatório quando kind='perguntar'. Uma pergunta objetiva, em português."),
  opcoes: z
    .array(z.string().max(80))
    .max(5)
    .optional()
    .describe("Obrigatório quando kind='perguntar'. De 2 a 5 respostas possíveis."),
  resumo: z
    .string()
    .max(400)
    .optional()
    .describe(
      "Obrigatório quando kind='pronto'. Resumo do plano em 1-2 frases, para a pessoa confirmar.",
    ),
});

type Saida = z.infer<typeof saidaSchema>;

/**
 * O que o `discriminatedUnion` garantia antes de o schema ser achatado.
 *
 * Sem isto, um `kind: "perguntar"` sem opções chegaria à tela como uma pergunta
 * de múltipla escolha SEM escolhas — beco sem saída, e pior que um erro, porque
 * parece que funcionou.
 */
function coerente(s: Saida): boolean {
  if (s.kind === "perguntar") {
    return (s.pergunta?.trim().length ?? 0) > 0 && (s.opcoes?.length ?? 0) >= 2;
  }
  return (s.resumo?.trim().length ?? 0) > 0;
}

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
    // Canônico, NÃO o id enviado ao provedor: a tradução para o nome que a
    // OpenRouter usa acontece depois, dentro do provider. Ver idNaOpenRouter.
    modeloCanonico: resolvido.modelId,
    origem: resolvido.origem,
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

    if (!coerente(gerado.object)) {
      // Trata como falha do provedor, e não como sucesso pela metade: mandar
      // para a tela uma pergunta sem opções seria pior que o erro, porque ela
      // não parece um erro.
      logger.error("flow.ai.interpretar.incoerente", {
        organizationId: authz.org.orgId,
        requestId,
        ms: Date.now() - t0,
        // Canônico, NÃO o id enviado ao provedor: a tradução para o nome que a
        // OpenRouter usa acontece depois, dentro do provider. Ver idNaOpenRouter.
        modeloCanonico: resolvido.modelId,
        origem: resolvido.origem,
        kind: gerado.object.kind,
      });
      return fail(
        "ai_provider_error",
        "A resposta da IA veio incompleta. Tente descrever de outro jeito.",
        502,
        { requestId },
      );
    }

    logger.info("flow.ai.interpretar.fim", {
      requestId,
      ms: Date.now() - t0,
      kind: gerado.object.kind,
    });
    return ok(gerado.object, { requestId });
  } catch (err) {
    // A causa vai para o LOG além da resposta: `details` só chega a quem abriu
    // o DevTools, e a pessoa que reporta o problema raramente é essa.
    logger.error("flow.ai.interpretar.falhou", {
      organizationId: authz.org.orgId,
      requestId,
      ms: Date.now() - t0,
      // Canônico, NÃO o id enviado ao provedor: a tradução para o nome que a
      // OpenRouter usa acontece depois, dentro do provider. Ver idNaOpenRouter.
      modeloCanonico: resolvido.modelId,
      origem: resolvido.origem,
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
