/**
 * Flow Engine — a única porta por onde a geração fala com um provedor.
 *
 * ═══ Por que uma porta, e não `generateObject` espalhado ═══
 *
 * Três coisas precisam valer igual em toda chamada da geração, e nenhuma delas
 * é opcional depois do que este passo já custou:
 *
 *   1. `finishReason` e `warnings` SEMPRE voltam ao chamador. São os campos que
 *      separam "o teto de tokens cortou" de "a validação recusou" — causas
 *      opostas que, sem eles, chegam ao log como a mesma frase.
 *   2. Falha nunca lança. Vira `{ ok: false, causa }`, porque a etapa 2 tem
 *      dezenas de chamadas e uma exceção derrubaria as irmãs — que é a doença
 *      que a geração multi-etapa veio curar.
 *   3. Fallback de modelo é tentado UMA vez e é LOGADO. "Funciona mas com outro
 *      modelo" não pode ser invisível: é a diferença entre um provedor lento e
 *      um provedor que recusa o formato, e ninguém descobre isso pelo silêncio.
 *
 * ═══ O que NÃO acontece aqui ═══
 *
 * Sem streaming: a geração por etapas não precisa dele (cada resposta é pequena
 * e chega inteira), e é justamente o streaming que transforma erro em stream
 * truncado sem status HTTP. Quem transmite progresso ao browser é a rota de
 * montagem, com eventos nossos — não o SDK.
 */
import { generateObject } from "ai";
import type { z } from "zod";

import { DEFAULT_BOT_MODEL, DEFAULT_CLASSIFIER_MODEL, type ModelId } from "@/lib/ai/gateway";
import { resolverModeloDoPonto, type ModeloResolvido } from "@/lib/ai/gateway-binding";
import { logger } from "@/lib/logger";

export interface ResultadoDoModelo<T> {
  ok: boolean;
  objeto?: T;
  causa?: string;
  /** "length" acusa o teto de tokens; "stop" acusa a validação. */
  finishReason?: string;
  /** Onde o SDK avisa que o provedor IGNOROU um ajuste nosso. */
  avisos: string[];
  tokensEntrada: number | null;
  tokensSaida: number | null;
  modeloUsado: string;
  /** `true` quando a resposta veio do modelo de reserva. */
  usouReserva: boolean;
}

export interface PedidoAoModelo<T> {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  maxOutputTokens: number;
  /** Aparece no log; identifica a chamada dentro da geração ("plano", "n3:logic.if"). */
  rotulo: string;
  sinal?: AbortSignal;
}

export interface PortaDeModelo {
  objeto<T>(pedido: PedidoAoModelo<T>): Promise<ResultadoDoModelo<T>>;
}

export interface CadeiaDeModelos {
  primario: ModeloResolvido;
  /** `null` quando não há segundo caminho configurado — não é erro. */
  reserva: ModeloResolvido | null;
}

/**
 * Resolve o modelo do ponto e, quando possível, um segundo para reserva.
 *
 * A reserva é o classificador porque os schemas desta frente são pequenos: o
 * plano é uma lista com um enum, e cada config é um objeto raso. Um modelo mais
 * barato dá conta dos dois, e ter reserva importa mais do que ter a melhor
 * reserva — o caso que se quer cobrir é "o primário recusou o formato", não "o
 * primário respondeu mal".
 *
 * Quando o painel da organização escolheu o modelo (`origem: "binding"`), a
 * reserva NÃO entra: quem configurou um modelo escolheu aquele, e trocá-lo por
 * baixo dos panos seria o mesmo pecado de um botão que não controla nada.
 */
export async function resolverCadeia(
  purpose: string,
  organizationId: string,
  padrao: ModelId = DEFAULT_BOT_MODEL,
  reserva: ModelId = DEFAULT_CLASSIFIER_MODEL,
): Promise<CadeiaDeModelos | null> {
  const primario = await resolverModeloDoPonto(purpose, organizationId, padrao);
  if (primario === null) return null;
  if (primario.origem === "binding") return { primario, reserva: null };
  if (String(reserva) === String(padrao)) return { primario, reserva: null };

  const segundo = await resolverModeloDoPonto(purpose, organizationId, reserva);
  // Mesmo id resolvido = não é reserva de nada; melhor declarar que não há.
  const util = segundo && segundo.modelId !== primario.modelId ? segundo : null;
  return { primario, reserva: util };
}

function causaDe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const comCorpo = err as Error & { statusCode?: unknown; responseBody?: unknown };
  const status = typeof comCorpo.statusCode === "number" ? ` [${comCorpo.statusCode}]` : "";
  // O corpo é onde o provedor escreve o motivo real; `message` resume tudo como
  // "Provider returned error", frase que não diz nada. Truncado porque a
  // resposta pode trazer o schema inteiro de volta.
  const corpo =
    typeof comCorpo.responseBody === "string" ? ` ${comCorpo.responseBody.slice(0, 400)}` : "";
  return `${err.message}${status}${corpo}`;
}

async function umaTentativa<T>(
  modelo: ModeloResolvido,
  pedido: PedidoAoModelo<T>,
  usouReserva: boolean,
): Promise<ResultadoDoModelo<T>> {
  try {
    const gerado = await generateObject({
      model: modelo.model,
      schema: pedido.schema,
      system: pedido.system,
      prompt: pedido.prompt,
      temperature: 0.2,
      maxOutputTokens: pedido.maxOutputTokens,
      abortSignal: pedido.sinal,
      // Mesma razão da rota antiga: o modo estrito impõe regras que estes
      // schemas não cumprem (campos com `default` ficam fora de `required`), e
      // deformá-los para agradar um formato de terceiro seria pior. A validação
      // continua onde importa — no Zod, depois que a resposta chega.
      providerOptions: { openai: { strictJsonSchema: false } },
    });
    return {
      ok: true,
      objeto: gerado.object,
      finishReason: gerado.finishReason,
      avisos: gerado.warnings?.map((w) => JSON.stringify(w).slice(0, 200)) ?? [],
      tokensEntrada: gerado.usage?.inputTokens ?? null,
      tokensSaida: gerado.usage?.outputTokens ?? null,
      modeloUsado: modelo.modelId,
      usouReserva,
    };
  } catch (err) {
    return {
      ok: false,
      causa: causaDe(err),
      avisos: [],
      tokensEntrada: null,
      tokensSaida: null,
      modeloUsado: modelo.modelId,
      usouReserva,
    };
  }
}

export function portaComFallback(
  cadeia: CadeiaDeModelos,
  ctx: { organizationId: string; requestId: string; flowId: string },
): PortaDeModelo {
  return {
    async objeto<T>(pedido: PedidoAoModelo<T>): Promise<ResultadoDoModelo<T>> {
      const t0 = Date.now();
      const primeira = await umaTentativa(cadeia.primario, pedido, false);
      if (primeira.ok) return primeira;

      // Abortado por quem pediu (a pessoa fechou o painel) não é falha de
      // provedor: repetir com outro modelo gastaria dinheiro para jogar fora.
      if (pedido.sinal?.aborted) return primeira;

      logger.warn("flow.ai.chamada_falhou", {
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        flowId: ctx.flowId,
        rotulo: pedido.rotulo,
        modelo: primeira.modeloUsado,
        ms: Date.now() - t0,
        causa: primeira.causa,
        finishReason: primeira.finishReason,
        warnings: primeira.avisos,
      });

      if (cadeia.reserva === null) return primeira;

      const segunda = await umaTentativa(cadeia.reserva, pedido, true);
      logger.warn("flow.ai.fallback_de_modelo", {
        organizationId: ctx.organizationId,
        requestId: ctx.requestId,
        flowId: ctx.flowId,
        rotulo: pedido.rotulo,
        de: cadeia.primario.modelId,
        para: cadeia.reserva.modelId,
        deu_certo: segunda.ok,
        ms: Date.now() - t0,
        causa: segunda.ok ? primeira.causa : segunda.causa,
        finishReason: segunda.finishReason,
        warnings: segunda.avisos,
      });
      return segunda;
    },
  };
}
