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
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { motivoDaEntradaRecusada } from "@/lib/flow-engine/ai/entrada";
import { promptDeInterpretacao, promptDoUsuario } from "@/lib/flow-engine/ai/prompt";
import {
  causaDe,
  portaComFallback,
  resolverCadeia,
} from "@/lib/flow-engine/ai/modelo-com-fallback";

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
    .describe(
      "Quando kind='perguntar' e resposta_livre=false: de 2 a 5 respostas possíveis. " +
        "Vazio quando a pergunta é aberta.",
    ),
  resposta_livre: z
    .boolean()
    .optional()
    .describe(
      "true quando a resposta não cabe numa lista (o texto de uma mensagem, o nome de uma " +
        "etiqueta, um telefone). Nesse caso 'opcoes' fica vazio e a pessoa digita.",
    ),
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
    if ((s.pergunta?.trim().length ?? 0) === 0) return false;
    // ⚠️ PERGUNTA ABERTA É COERENTE, e antes não era. A regra exigia ≥2 opções
    // de TODA pergunta, então o modelo, para perguntar "qual o texto da
    // mensagem?", tinha de inventar três textos — e a pessoa era obrigada a
    // escolher entre coisas que não eram as dela. O beco sem saída que a regra
    // existe para impedir é pergunta sem pergunta e sem caminho, não pergunta
    // que se responde escrevendo.
    if (s.resposta_livre === true) return true;
    return (s.opcoes?.length ?? 0) >= 2;
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
  // O `[id]` não é lido do banco (ver o cabeçalho), mas entra no log da porta:
  // sem ele, uma falha de provedor no `docker logs` não diz de qual fluxo veio.
  const { id: flowId } = await ctx.params;

  const corpo = await req.json().catch(() => ({}));
  const lido = entradaSchema.safeParse(corpo);
  if (!lido.success) {
    return fail("validation_failed", motivoDaEntradaRecusada(lido.error, corpo), 422, {
      requestId,
    });
  }

  const orcamento = await orcamentoPermite(authz.org.orgId, PURPOSE);
  if (!orcamento.permitido) {
    return fail("ai_budget_exceeded", orcamento.motivo ?? "Orçamento de IA esgotado.", 402, {
      requestId,
    });
  }

  // ⚠️ PELA PORTA, e não `generateObject` direto. Esta era a única das três
  // rotas de IA de fluxo que chamava o SDK na mão, e por isso a única sem
  // fallback de modelo e sem a escalada de teto quando a resposta volta
  // cortada — as duas recuperações que as irmãs ganham de graça. Aqui a
  // ausência doía mais: é o PRIMEIRO passo da conversa, então uma recusa do
  // provedor matava o painel antes de a pessoa ter chegado a pedir um fluxo.
  const cadeia = await resolverCadeia(PURPOSE, authz.org.orgId);
  if (cadeia === null) {
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
    modeloCanonico: cadeia.primario.modelId,
    origem: cadeia.primario.origem,
  });

  try {
    const porta = portaComFallback(cadeia, {
      organizationId: authz.org.orgId,
      requestId,
      flowId,
    });
    const resposta = await porta.objeto({
      schema: saidaSchema,
      system: promptDeInterpretacao(),
      prompt: promptDoUsuario(lido.data.pedido, lido.data.historico),
      rotulo: "interpretar",
      sinal: req.signal,
      // Uma pergunta + opções, ou um resumo curto — nenhum dos dois precisa
      // de espaço. Baixo de propósito: a lição medida em
      // workers/ai-sentiment-worker.ts é que pouco tokens trunca o JSON no
      // meio; 600 é folgado para o teto de 300/400 caracteres dos campos. E,
      // se ainda assim vier cortada, a porta escala uma vez sozinha.
      maxOutputTokens: 600,
    });

    if (!resposta.ok || resposta.objeto === undefined) {
      logger.error("flow.ai.interpretar.falhou", {
        organizationId: authz.org.orgId,
        requestId,
        ms: Date.now() - t0,
        modeloCanonico: resposta.modeloUsado,
        causa: resposta.causa ?? "sem causa",
        finishReason: resposta.finishReason,
        // `warnings` e não `avisos`: é o nome que as rotas irmãs usam, e é por ele
        // que a cerca de observabilidade procura em todas as três.
        warnings: resposta.avisos,
      });
      // A causa do provedor, e não uma frase nossa: é ela que distingue
      // "nenhum provedor configurado" de "o modelo recusou o formato".
      return fail("ai_provider_error", resposta.causa ?? "A IA não respondeu. Tente de novo.", 502, {
        requestId,
        details: { causa: resposta.causa },
      });
    }

    const gerado = { object: resposta.objeto };

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
        modeloCanonico: cadeia.primario.modelId,
        origem: cadeia.primario.origem,
        kind: gerado.object.kind,
        // Ver o comentário irmão em `ai/gerar`: "length" acusa o teto de tokens,
        // "stop" acusa o modelo; e `warnings` é onde o SDK avisa que o provedor
        // IGNOROU um ajuste (o `response_format`, tipicamente).
        finishReason: resposta.finishReason,
        // `warnings` e não `avisos`: é o nome que as rotas irmãs usam, e é por ele
        // que a cerca de observabilidade procura em todas as três.
        warnings: resposta.avisos,
        tokens_saida: resposta.tokensSaida,
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
      finishReason: resposta.finishReason,
      // `warnings` e não `avisos`: é o nome que as rotas irmãs usam, e é por ele
      // que a cerca de observabilidade procura em todas as três.
      warnings: resposta.avisos,
      // Sobe quando o primário recusou e a reserva salvou — é o número que diz
      // se o fallback desta rota está sendo usado de verdade.
      usouReserva: resposta.usouReserva,
      tokens_entrada: resposta.tokensEntrada,
      tokens_saida: resposta.tokensSaida,
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
      modeloCanonico: cadeia.primario.modelId,
      origem: cadeia.primario.origem,
      // `causaDe`, e não `err.message`: a mensagem do SDK para uma resposta
      // cortada fala de PARSE, e foi ela que mandou cinco correções seguidas
      // procurarem no schema e no provedor. Ver o cabeçalho da função.
      causa: causaDe(err),
    });
    return fail(
      "ai_provider_error",
      "Não consegui entender o pedido. Tente descrever de outro jeito.",
      502,
      { requestId, details: { causa: causaDe(err) } },
    );
  }
}
