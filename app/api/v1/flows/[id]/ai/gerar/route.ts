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
import { logger } from "@/lib/logger";
import { requireRole } from "@/lib/auth/require-role";
import { DEFAULT_BOT_MODEL } from "@/lib/ai/gateway";
import { resolverModeloDoPonto } from "@/lib/ai/gateway-binding";
import { orcamentoPermite } from "@/lib/flow-engine/ai/budget-gate";
import { montarSchemaDeGeracao } from "@/lib/flow-engine/ai/generation-schema";
import { promptDeGeracao, promptDoUsuario } from "@/lib/flow-engine/ai/prompt";

export const dynamic = "force-dynamic";

/**
 * VALE NA VERCEL, NÃO NO SELF-HOST — mesma ressalva da rota irmã `interpretar`.
 *
 * Faltava aqui, e a assimetria era exatamente ao contrário do que faz sentido: a
 * rota LEVE (600 tokens de saída, modelo classificador) declarava teto e a rota
 * PESADA (4000 tokens, até 60 nós, modelo principal) não declarava nenhum. Em
 * `output: "standalone"` quem limita é o proxy à frente; na Vercel o default
 * mataria esta chamada muito antes de o modelo terminar.
 */
export const maxDuration = 300;

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

/**
 * Extrai do erro do SDK o que o PROVEDOR disse — status e corpo da resposta.
 *
 * `AI_APICallError` carrega `statusCode` e `responseBody`, mas o `message` que
 * chega ao log é só "Provider returned error". O corpo é onde a OpenRouter
 * escreve o motivo (schema recusado, modelo indisponível, crédito acabado), e
 * é a diferença entre diagnosticar em um minuto e em uma rodada de deploy.
 *
 * Sem `any` e sem depender do tipo do SDK: lê as propriedades se existirem.
 * Truncado em 600 caracteres porque a resposta pode trazer o schema inteiro de
 * volta, e o log não é lugar para isso.
 */
function detalheDaChamada(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) return {};
  const e = error as { statusCode?: unknown; responseBody?: unknown; url?: unknown };
  const saida: Record<string, unknown> = {};
  if (typeof e.statusCode === "number") saida.status = e.statusCode;
  if (typeof e.responseBody === "string") saida.resposta = e.responseBody.slice(0, 600);
  if (typeof e.url === "string") saida.url = e.url;
  return saida;
}

/**
 * Extrai os CAMINHOS que a validação recusou, quando o erro é do Zod.
 *
 * `nodes.17.config.mensagem` diz qual bloco e qual campo derrubaram o objeto
 * inteiro. Sem isto, um único `config` divergente entre 60 nós perfeitos vira a
 * mesma frase genérica de sempre, e não há como saber se o modelo errou um
 * campo ou se o provedor recusou o pedido — que são consertos opostos.
 *
 * Sem `any` e sem depender do tipo do SDK: `TypeValidationError` guarda o erro
 * do Zod em `cause`, e o Zod expõe `issues` com `path`. Teto de 8 caminhos
 * porque a lista repete o mesmo bloco quando a união tenta as 11 variantes.
 */
function caminhosRecusados(error: unknown): string[] {
  const visto = new Set<string>();
  const fila: unknown[] = [error];
  while (fila.length > 0 && visto.size < 8) {
    const atual = fila.shift();
    if (typeof atual !== "object" || atual === null) continue;
    const e = atual as { issues?: unknown; cause?: unknown; value?: unknown };
    if (Array.isArray(e.issues)) {
      for (const bruto of e.issues) {
        if (typeof bruto !== "object" || bruto === null) continue;
        const issue = bruto as { path?: unknown };
        if (!Array.isArray(issue.path)) continue;
        visto.add(issue.path.join("."));
        if (visto.size >= 8) break;
      }
    }
    if (e.cause !== undefined) fila.push(e.cause);
  }
  return [...visto];
}

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

  // DEFAULT_BOT_MODEL, não o CLASSIFIER: esta rota monta um fluxo inteiro — até
  // 60 nós, 11 tipos, com arestas coerentes entre eles —, que é o trabalho mais
  // pesado de IA do produto. O classificador estava aqui por cópia da rota
  // irmã (`interpretar`), onde ele é a escolha certa porque a tarefa é decidir
  // entre duas saídas curtas. Só afeta quem NÃO configurou o ponto no painel,
  // que é justamente a instalação recém-instalada.
  const resolvido = await resolverModeloDoPonto(PURPOSE, authz.org.orgId, DEFAULT_BOT_MODEL);
  if (!resolvido) {
    return fail(
      "ai_provider_error",
      "Nenhum provedor de IA está configurado nesta organização. Configure um em Uso de IA › Provedores.",
      422,
      { requestId },
    );
  }

  // Instrumentação: esta rota não registrava NADA, e isso custou caro. Quando o
  // passo falhou em produção, o log do app não tinha uma linha sobre ela e o
  // `api_audit_log` tinha ZERO — o que, por si só, já foi a primeira pista
  // (o `onFinish` audita a falha, então audit vazio significa que ele nem
  // chegou a rodar).
  const t0 = Date.now();
  logger.info("flow.ai.gerar.inicio", {
    organizationId: authz.org.orgId,
    requestId,
    flowId,
    // Canônico, NÃO o id enviado ao provedor — a tradução para o nome da
    // OpenRouter acontece dentro do provider (ver idNaOpenRouter).
    modeloCanonico: resolvido.modelId,
    origem: resolvido.origem,
  });

  const resultado = streamObject({
    model: resolvido.model,
    schema: montarSchemaDeGeracao(),
    system: promptDeGeracao(),
    prompt: promptDoUsuario(lido.data.pedido, lido.data.historico),
    temperature: 0.2,
    /**
     * SEM ISTO, O ERRO DO STREAM NÃO EXISTE EM LUGAR NENHUM.
     *
     * `streamObject` já enviou os cabeçalhos 200 quando o modelo falha, então a
     * falha não pode virar status HTTP: ela vira um stream truncado, e o SDK
     * engole a exceção. A tela dizia só "A IA não conseguiu terminar o fluxo",
     * o servidor não dizia nada, e não havia como saber se o culpado era o
     * modelo, o schema ou o proxy.
     *
     * Este callback é o ÚNICO ponto em que essa causa é observável.
     */
    onError: ({ error }) => {
      logger.error("flow.ai.gerar.erro_no_stream", {
        organizationId: authz.org.orgId,
        requestId,
        flowId,
        ms: Date.now() - t0,
        modeloCanonico: resolvido.modelId,
        causa: error instanceof Error ? error.message : String(error),
        // `error.message` do SDK resume tudo como "Provider returned error" —
        // frase que não diz NADA sobre o que o provedor recusou. O motivo real
        // vem no corpo da resposta HTTP, e sem ele a investigação custou uma
        // rodada inteira de deploy só para descobrir o que já estava ali.
        ...detalheDaChamada(error),
      });
      void audit({
        action: "flow.ai_generation_failed",
        actorUserId: authz.user.id,
        organizationId: authz.org.orgId,
        resourceType: "flow",
        resourceId: flowId,
        requestId,
        metadata: {
          onde: "stream",
          causa: error instanceof Error ? error.message : String(error),
          modelo: resolvido.modelId,
        },
      });
    },
    // Um fluxo cabe em até 60 nós (teto do schema); 4000 é folgado para isso
    // sem virar cheque em branco — a lição de `ai-sentiment-worker.ts` é que
    // pouco tokens trunca o JSON no meio, não que muito tokens seja de graça.
    maxOutputTokens: 4000,
    /**
     * MODO ESTRITO DESLIGADO — o schema deste ponto não cabe nele.
     *
     * Structured Outputs em modo estrito impõe regras que este schema viola por
     * construção, e medi-las foi o que fechou o diagnóstico: `z.discriminatedUnion`
     * emite `oneOf` (o estrito aceita só `anyOf`), campos com `default` ficam
     * fora de `required` (o estrito exige TODAS), e a raiz não declara
     * `additionalProperties: false`.
     *
     * Consertar as três no schema significaria deformá-lo para agradar um
     * formato de terceiro — e ele é a fonte de verdade dos blocos do produto,
     * usada também pelo runtime e pela tela. Desligar o estrito mantém a
     * validação onde ela importa: o objeto continua conferido contra o Zod, no
     * servidor e no cliente, depois que chega.
     *
     * `openai` é o nome do provider mesmo apontando para a OpenRouter — ela é
     * OpenAI-compatível e o cliente é `createOpenAI` (ver lib/ai/gateway.ts).
     */
    providerOptions: { openai: { strictJsonSchema: false } },
    /**
     * `finishReason` e `warnings` são a diferença entre duas causas OPOSTAS que
     * chegam à tela com a mesma frase — e o SDK já os entregava aqui, de graça,
     * enquanto esta rota lia só `object`/`error`/`usage` e jogava os dois fora.
     *
     *   finishReason: "length"  -> o teto de tokens cortou o JSON no meio
     *                              (inclusive se o modelo gastou o teto raciocinando)
     *   finishReason: "stop"    -> o modelo terminou e a VALIDAÇÃO recusou
     *
     * `warnings` é onde o SDK avisa que o provedor IGNOROU um ajuste — é assim
     * que se descobre que a OpenRouter descartou o `response_format` em vez de
     * adivinhar.
     */
    onFinish: ({ object, error, usage, finishReason, warnings, reasoning }) => {
      // Fire-and-forget, fora do caminho de resposta: o stream já foi
      // entregue ao cliente independente deste bloco. Falha aqui não pode
      // derrubar a geração que a pessoa já está vendo terminar.
      if (error || !object) {
        // `!object` sem `error` é o caso traiçoeiro: o stream TERMINOU, sem
        // exceção, e mesmo assim não há objeto — resposta truncada ou que não
        // satisfaz o schema. Registrar os dois separadamente é o que permite
        // distinguir "o modelo recusou" de "veio pela metade".
        logger.error("flow.ai.gerar.sem_objeto", {
          organizationId: authz.org.orgId,
          requestId,
          flowId,
          ms: Date.now() - t0,
          modeloCanonico: resolvido.modelId,
          teveErro: Boolean(error),
          causa: error instanceof Error ? error.message : error ? String(error) : "objeto ausente",
          // O discriminador: "length" acusa o teto de tokens; "stop" acusa a
          // validação. Sem ele, os dois chegam como "sem objeto".
          finishReason,
          avisos: warnings?.map((w) => JSON.stringify(w).slice(0, 200)) ?? [],
          // Quando o modelo raciocina, o teto de tokens é dividido com o
          // raciocínio — e o JSON pode nem começar. O tamanho aqui é o que
          // permite ver isso sem ecoar o conteúdo do raciocínio no log.
          raciocinio_chars: reasoning?.length ?? 0,
          caminhos_recusados: caminhosRecusados(error),
          tokens_entrada: usage?.inputTokens ?? null,
          tokens_saida: usage?.outputTokens ?? null,
        });
        void audit({
          action: "flow.ai_generation_failed",
          actorUserId: authz.user.id,
          organizationId: authz.org.orgId,
          resourceType: "flow",
          resourceId: flowId,
          requestId,
          metadata: {
            onde: "onFinish",
            causa: error instanceof Error ? error.message : String(error),
          },
        });
        return;
      }

      logger.info("flow.ai.gerar.fim", {
        organizationId: authz.org.orgId,
        requestId,
        flowId,
        ms: Date.now() - t0,
        // As contagens separam "veio inteiro" de "veio pela metade" sem precisar
        // do objeto: um fluxo com 1 nó e 0 arestas é truncamento, não sucesso.
        nos: object.nodes.length,
        arestas: object.edges.length,
        finishReason,
        avisos: warnings?.map((w) => JSON.stringify(w).slice(0, 200)) ?? [],
        tokens_entrada: usage?.inputTokens ?? null,
        tokens_saida: usage?.outputTokens ?? null,
      });
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
