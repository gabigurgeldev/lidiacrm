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
import { NoObjectGeneratedError, generateObject } from "ai";
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
 *
 * ═══ ⚠️ O BARATO É O PADRÃO, E O FORTE É A RESERVA — ERA O CONTRÁRIO ═══
 *
 * A ordem estava invertida: o padrão era `DEFAULT_BOT_MODEL` (o carro-chefe) e
 * a reserva era o classificador. Isso faz sentido para CONVERSAR com o cliente;
 * não faz nenhum aqui. Gerar um fluxo é extração estruturada — escolher tipos
 * de uma lista fechada e escrever rótulos curtos. É trabalho de modelo barato,
 * e a conta de usar o caro é medida, não estimada:
 *
 *   plano de 15 blocos, carro-chefe   6006 tokens de saída, 55-77s
 *   o MESMO plano, classificador      ~1400 tokens de saída, 8,4s
 *
 * A saída do carro-chefe é quatro vezes maior do que o JSON que ele devolve —
 * o excedente é o modelo pensando, e pensar é cobrado como saída. Somado ao
 * preço por token (US$ 10/M contra US$ 5/M), a geração inteira saía por
 * ~US$ 0,116 e passa a ~US$ 0,035, com resposta em segundos em vez de minutos.
 *
 * O forte continua no desenho, no lugar certo: entra quando o barato FALHA,
 * não antes. E quem quiser o carro-chefe sempre continua podendo escolhê-lo em
 * Uso de IA › Provedores — a escolha do painel segue ganhando de tudo isto.
 */
export async function resolverCadeia(
  purpose: string,
  organizationId: string,
  padrao: ModelId = DEFAULT_CLASSIFIER_MODEL,
  reserva: ModelId = DEFAULT_BOT_MODEL,
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

/**
 * O TETO SOBE UMA VEZ QUANDO A RESPOSTA VOLTA CORTADA.
 *
 * Uma resposta cortada não é falha do modelo nem do schema: é falta de espaço,
 * e a única recuperação possível é dar espaço. Repetir com o MESMO teto — que
 * é o que a etapa 2 faz hoje, duas vezes por bloco — gasta dinheiro para chegar
 * ao mesmo corte, porque nada na segunda chamada é diferente da primeira.
 *
 * O fator existe para que o número escrito em `TOKENS_DO_PLANO` (e em
 * `TOKENS_POR_CONFIG`) não precise estar certo: ele precisa estar certo para o
 * caso COMUM, e a escalada cobre a cauda. É o oposto do desenho anterior, em
 * que um número apertado escrito uma vez decidia sozinho o destino de toda
 * geração.
 */
export const FATOR_DE_ESCALADA = 2;

/**
 * O teto nunca passa daqui, e o motivo é de compatibilidade — NÃO de custo.
 *
 * ⚠️ Teto alto não custa nada. Cobra-se pelo token GERADO, não pelo
 * autorizado: um plano de 6 blocos sob um teto de 12.000 custa exatamente o
 * mesmo que sob um teto de 1.200 — a diferença é que sob 1.200 ele não cabe.
 * Foi confundir as duas coisas que produziu um teto apertado "para economizar"
 * e, com ele, uma feature que não funcionava.
 *
 * O que limita de verdade é o modelo: a saída máxima declarada varia (o
 * classificador aceita 64.000; há modelos na OpenRouter que param em 4.096), e
 * pedir acima do que o modelo aceita é recusado pelo endpoint com erro de
 * parâmetro. Uma escalada sem limite trocaria "resposta cortada" por
 * "requisição inválida" — pior, porque não parece falta de espaço.
 */
export const TETO_MAXIMO_DE_SAIDA = 12000;

/**
 * O TETO DESCE quando o ENDPOINT recusa o número — o espelho da escalada.
 *
 * Medido no catálogo da OpenRouter (419 modelos): **26 declaram saída máxima
 * abaixo de `TOKENS_DO_PLANO`** — 14 param em 4096, 9 abaixo disso, e o menor
 * em 2048 (Nova, Command-R e alguns modelos pequenos estão nesse grupo). Para
 * eles, pedir o teto que os outros 94% precisam é recusado pelo endpoint antes
 * de gerar um token.
 *
 * Sem esta queda, subir o teto para consertar a maioria QUEBRARIA essa minoria
 * — que hoje funciona para fluxos pequenos. 2048 é o menor teto do catálogo,
 * então é o único número que serve a todos; pelos ~90 tokens por bloco medidos,
 * ele ainda comporta um fluxo de ~22 blocos.
 *
 * A tentativa recusada não custa nada: o endpoint recusa o PARÂMETRO, sem
 * gerar saída.
 */
export const TETO_SEGURO_DE_SAIDA = 2048;

/** A resposta foi interrompida por falta de espaço, não pelo modelo. */
function foiCortada(finishReason: string | undefined): boolean {
  return finishReason === "length";
}

/**
 * O endpoint recusou o TAMANHO pedido — não o pedido.
 *
 * Casa pelo texto porque não há código de erro para isto: cada endpoint
 * compatível com OpenAI escreve a sua frase, e todas nomeiam o parâmetro. A
 * varredura é sobre a causa já montada por `causaDe`, que inclui o corpo da
 * resposta — que é onde o provedor escreve o motivo real.
 */
function tetoFoiRecusado(causa: string | undefined): boolean {
  if (causa === undefined) return false;
  return /max_(?:tokens|output_tokens|completion_tokens)/i.test(causa);
}

/**
 * A causa de uma falha de modelo, em palavras que apontam para o lugar certo.
 *
 * Exportada porque `ai/interpretar` — a PRIMEIRA rota que a tela chama — não
 * passa por esta porta (ela chama `generateObject` direto) e logava só
 * `err.message`. Se o corte acontecesse ali, quem investigasse leria de novo
 * "could not parse the response" e recomeçaria a busca no schema. A cegueira
 * era a mesma; o que faltava era a função estar ao alcance.
 */
export function causaDe(err: unknown): string {
  // ⚠️ ESTE RAMO É A DIFERENÇA ENTRE UM DIAGNÓSTICO E CINCO CORREÇÕES ERRADAS.
  //
  // `NoObjectGeneratedError` chega com a mensagem "could not parse the
  // response", que fala de PARSE. Quando a causa real é o teto de tokens, essa
  // frase manda quem investiga para o schema e para o provedor — os dois
  // lugares onde não está. `finishReason`, `usage` e o texto parcial vêm dentro
  // do erro e nada os lia; agora vêm escritos na causa, que é o campo que a
  // rota loga e devolve à tela em `details.causa`.
  if (NoObjectGeneratedError.isInstance(err)) {
    const saida = err.usage?.outputTokens ?? null;
    if (foiCortada(err.finishReason)) {
      return (
        `a resposta foi CORTADA no teto de tokens (finishReason: length` +
        `${saida === null ? "" : `, ${saida} tokens de saída`}) — não é erro de schema ` +
        `nem do provedor: o plano ficou maior do que o espaço pedido`
      );
    }
    const texto = (err.text ?? "").trim();
    return (
      `o modelo não devolveu o objeto pedido (finishReason: ${err.finishReason ?? "?"})` +
      `${texto === "" ? "" : `: ${texto.slice(0, 300)}`}`
    );
  }
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
    // `finishReason` no caminho de ERRO, e não só no de sucesso: sem ele o
    // chamador não distingue "cortada no teto" (que a escalada resolve) de
    // "recusada" (que ela só encareceria). Era o campo que faltava para a
    // decisão logo abaixo poder existir.
    const cortada = NoObjectGeneratedError.isInstance(err);
    return {
      ok: false,
      causa: causaDe(err),
      finishReason: cortada ? err.finishReason : undefined,
      avisos: [],
      tokensEntrada: cortada ? (err.usage?.inputTokens ?? null) : null,
      tokensSaida: cortada ? (err.usage?.outputTokens ?? null) : null,
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
      // O teto REALMENTE em uso. Ele deixa de ser `pedido.maxOutputTokens`
      // assim que a queda abaixo entra: sem rastreá-lo, a escalada partiria do
      // número que o endpoint ACABOU de recusar e pediria o dobro dele.
      let tetoEmUso = pedido.maxOutputTokens;
      let primeira = await umaTentativa(cadeia.primario, pedido, false);
      if (primeira.ok) return primeira;

      // Abortado por quem pediu (a pessoa fechou o painel) não é falha de
      // provedor: repetir com outro modelo gastaria dinheiro para jogar fora.
      if (pedido.sinal?.aborted) return primeira;

      // ── O ENDPOINT RECUSOU O TETO: pedir menos, no MESMO modelo ────────────
      //
      // Antes da escalada, porque é o caso oposto e não pode ser confundido com
      // ele: aqui não faltou espaço, sobrou número. Ver `TETO_SEGURO_DE_SAIDA`
      // para os 26 modelos do catálogo que vivem abaixo do teto normal.
      if (tetoFoiRecusado(primeira.causa) && pedido.maxOutputTokens > TETO_SEGURO_DE_SAIDA) {
        logger.warn("flow.ai.teto_recusado", {
          organizationId: ctx.organizationId,
          requestId: ctx.requestId,
          flowId: ctx.flowId,
          rotulo: pedido.rotulo,
          modelo: primeira.modeloUsado,
          teto_pedido: pedido.maxOutputTokens,
          teto_seguro: TETO_SEGURO_DE_SAIDA,
          causa: primeira.causa,
        });
        const menor = await umaTentativa(
          cadeia.primario,
          { ...pedido, maxOutputTokens: TETO_SEGURO_DE_SAIDA },
          false,
        );
        if (menor.ok) return menor;
        if (pedido.sinal?.aborted) return menor;
        tetoEmUso = TETO_SEGURO_DE_SAIDA;
        // A causa passa a ser a da tentativa que REALMENTE tentou gerar. A
        // primeira só disse "esse número não serve", que não ajuda ninguém a
        // entender por que o fluxo não saiu.
        primeira = menor;
      }

      // ── A RESPOSTA VOLTOU CORTADA: dar espaço, no MESMO modelo ─────────────
      //
      // Antes do fallback de MODELO, porque trocar de modelo não é recuperação
      // para falta de espaço: o modelo de reserva recebe o mesmo teto e é
      // cortado do mesmo jeito. Foi assim que o defeito sobreviveu — a reserva
      // às vezes salvava por ser mais concisa, o que fazia a geração falhar de
      // forma INTERMITENTE e mandava a investigação para todos os lugares
      // errados.
      //
      // Só uma vez, e só para cima do teto declarado: duas escaladas seriam
      // três chamadas pagas por uma resposta, com alguém olhando a tela.
      const espacoMaior = Math.min(tetoEmUso * FATOR_DE_ESCALADA, TETO_MAXIMO_DE_SAIDA);
      if (foiCortada(primeira.finishReason) && espacoMaior > tetoEmUso) {
        logger.warn("flow.ai.resposta_cortada", {
          organizationId: ctx.organizationId,
          requestId: ctx.requestId,
          flowId: ctx.flowId,
          rotulo: pedido.rotulo,
          modelo: primeira.modeloUsado,
          ms: Date.now() - t0,
          teto_pedido: tetoEmUso,
          teto_novo: espacoMaior,
          tokens_saida: primeira.tokensSaida,
        });
        const comFolga = await umaTentativa(
          cadeia.primario,
          { ...pedido, maxOutputTokens: espacoMaior },
          false,
        );
        if (comFolga.ok) return comFolga;
        // A escalada é uma chamada nova, e a pessoa pode ter fechado o painel
        // DURANTE ela. Sem esta linha, a mesma guarda que existe antes da
        // escalada deixaria de valer depois dela, e um cancelamento no meio
        // ainda pagaria a chamada à reserva.
        if (pedido.sinal?.aborted) return comFolga;
        // A escalada falhou. A causa que segue para a tela continua sendo a do
        // CORTE, não a desta segunda chamada: se o endpoint recusou o teto
        // maior (modelos de saída curta fazem isso), a mensagem dele fala de
        // parâmetro inválido e esconderia o fato acionável — a resposta não
        // coube. A causa nova não some: vai para o log, aqui.
        logger.warn("flow.ai.escalada_falhou", {
          organizationId: ctx.organizationId,
          requestId: ctx.requestId,
          flowId: ctx.flowId,
          rotulo: pedido.rotulo,
          modelo: comFolga.modeloUsado,
          teto_novo: espacoMaior,
          causa: comFolga.causa,
          finishReason: comFolga.finishReason,
        });
        // Cortada DE NOVO com o dobro do espaço é informação diferente de
        // cortada uma vez, e é ela que o chamador precisa para dizer à pessoa
        // que o pedido é grande demais em vez de mandá-la tentar de novo.
        if (foiCortada(comFolga.finishReason)) primeira = comFolga;
      }

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

      // A reserva herda o teto MAIOR quando a falha foi corte. Mandá-la com o
      // teto original repetiria o erro com outro modelo e cobraria por isso —
      // e é exatamente o que acontecia antes desta linha existir.
      const paraAReserva = foiCortada(primeira.finishReason)
        ? { ...pedido, maxOutputTokens: espacoMaior }
        : pedido;
      const segunda = await umaTentativa(cadeia.reserva, paraAReserva, true);
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
