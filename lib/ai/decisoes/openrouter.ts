/**
 * MODELOS DE DECISÃO da OpenRouter — a API que não gera texto.
 *
 * A OpenRouter tem uma categoria própria, "Decisions" (GPT-6 Luna Decisions,
 * Perplexity Decider, Liquid d1, Clef, jev…), servida por outra rota: em vez de
 * mensagens, recebe um `state` (o contexto) e perguntas tipadas, e devolve a
 * PROBABILIDADE de cada opção. Para escolher quem conduz uma conversa é
 * exatamente o que se quer: sem texto para interpretar, sem JSON para o modelo
 * errar, e uma confiança que vem do modelo em vez de ser autodeclarada.
 *
 * Medido em produção (2026-10-10), mensagem "minha tia faleceu ontem, preciso
 * de algo bonito pra despedida", três destinos: `coroa` com 0,97, em ~400 ms,
 * US$ 0,0000232 — contra ~2,3 s de um modelo de chat fazendo a mesma escolha.
 *
 * Contrato (docs da OpenRouter, rota `createSystemone`):
 *   POST https://openrouter.ai/api/v1/systemone
 *   { model, state, questions: { <nome>: { type: "choice", instructions, criteria: { <opção>: <descrição> } } } }
 *   → { model, answers: { <nome>: { type, choice, probabilities?, confidence? } }, usage: { input_tokens, output_tokens, cost? } }
 */
import { z } from "zod";

export const URL_DE_DECISOES = "https://openrouter.ai/api/v1/systemone";
const URL_DA_LISTA = "https://openrouter.ai/api/v1/models?output_modalities=decisions";

const respostaSchema = z.object({
  model: z.string(),
  answers: z.record(
    z.string(),
    z.object({
      type: z.string(),
      choice: z.string().optional(),
      probabilities: z.record(z.string(), z.number()).optional(),
      confidence: z.number().optional(),
    }),
  ),
  usage: z
    .object({
      input_tokens: z.number().optional(),
      output_tokens: z.number().optional(),
      cost: z.number().optional(),
    })
    .optional(),
});

export interface PerguntaDeEscolha {
  /** O que o modelo deve decidir, em português. */
  instrucoes: string;
  /** chave da opção → descrição de quando ela vale. */
  opcoes: Record<string, string>;
}

export interface Escolha {
  escolha: string;
  /** Probabilidade da opção escolhida (ou a confiança informada). */
  confianca: number | null;
  probabilidades: Record<string, number>;
  /** O modelo concreto que respondeu (com a data da versão). */
  modelo: string;
  custoUsd: number | null;
  tokensEntrada: number;
}

export class DecisaoRecusadaError extends Error {
  override readonly name = "decisao_recusada";
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message);
  }
}

/**
 * Uma pergunta de escolha. Lança `DecisaoRecusadaError` com a causa (HTTP,
 * resposta fora do contrato, escolha fora das opções) — quem chama transforma
 * em "falhou" e aplica o fallback.
 */
export async function escolherComModeloDeDecisao(args: {
  apiKey: string;
  modelo: string;
  state: unknown;
  pergunta: PerguntaDeEscolha;
  sinal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<Escolha> {
  const f = args.fetchImpl ?? fetch;
  const res = await f(URL_DE_DECISOES, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: args.modelo,
      state: args.state,
      questions: {
        destino: { type: "choice", instructions: args.pergunta.instrucoes, criteria: args.pergunta.opcoes },
      },
    }),
    ...(args.sinal ? { signal: args.sinal } : {}),
  });
  const texto = await res.text();
  if (!res.ok) {
    // A mensagem do provedor (sem a chave, que nunca viaja na resposta) é o
    // que diz se foi modelo inexistente, saldo ou limite.
    let msg = texto.slice(0, 200);
    try {
      msg = (JSON.parse(texto) as { error?: { message?: string } }).error?.message?.slice(0, 200) ?? msg;
    } catch {
      /* corpo não-JSON: fica o começo dele */
    }
    throw new DecisaoRecusadaError(`modelo de decisão recusou (${res.status}): ${msg}`, res.status);
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw new DecisaoRecusadaError("resposta do modelo de decisão não é JSON", res.status);
  }
  const lido = respostaSchema.safeParse(corpo);
  if (!lido.success) throw new DecisaoRecusadaError("resposta do modelo de decisão fora do contrato", res.status);
  const resposta = lido.data.answers.destino;
  const escolha = resposta?.choice;
  if (!escolha || !(escolha in args.pergunta.opcoes)) {
    throw new DecisaoRecusadaError("o modelo de decisão escolheu uma opção que não existe", res.status);
  }
  const probabilidades = resposta.probabilities ?? {};
  const confianca = probabilidades[escolha] ?? resposta.confidence ?? null;
  return {
    escolha,
    confianca: confianca === null ? null : Math.min(1, Math.max(0, confianca)),
    probabilidades,
    modelo: lido.data.model,
    custoUsd: lido.data.usage?.cost ?? null,
    tokensEntrada: Math.round(lido.data.usage?.input_tokens ?? 0),
  };
}

// ─── Quais modelos são de decisão ──────────────────────────────────────────

let cache: { ids: Set<string>; ate: number } | null = null;
const UMA_HORA = 60 * 60 * 1000;

/**
 * Os ids da categoria Decisions, pela lista ao vivo da OpenRouter (19 em
 * 2026-10-10). Em memória por uma hora: a lista muda com lançamentos, não a
 * cada mensagem. Falhou a busca → conjunto vazio, e quem pergunta usa
 * `pareceModeloDeDecisao` como rede.
 */
export async function listarModelosDeDecisao(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  const agora = Date.now();
  if (cache && cache.ate > agora) return cache.ids;
  try {
    const res = await fetchImpl(URL_DA_LISTA, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return cache?.ids ?? new Set();
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const ids = new Set((json.data ?? []).map((m) => m.id).filter((x): x is string => typeof x === "string"));
    if (ids.size > 0) cache = { ids, ate: agora + UMA_HORA };
    return ids;
  } catch {
    return cache?.ids ?? new Set();
  }
}

/** Rede quando a lista não pôde ser lida: o nome entrega a categoria. */
export function pareceModeloDeDecisao(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return /(decision|decider|decide|\/jev-(\d|latest)|\/clef|\/d1$|\/drex|\/span-01|\/kev-|\/tev1)/u.test(id);
}

export async function ehModeloDeDecisao(modelId: string, apiKey: string): Promise<boolean> {
  const ids = await listarModelosDeDecisao(apiKey);
  return ids.size > 0 ? ids.has(modelId) : pareceModeloDeDecisao(modelId);
}

/** Só para testes. */
export function limparCacheDeModelosDeDecisao(): void {
  cache = null;
}
