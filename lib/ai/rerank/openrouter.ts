/**
 * A REORDENAÇÃO (RERANK) DAS BUSCAS DO AGENTE.
 *
 * ## O problema
 *
 * Toda busca do agente — material, produtos, notas do contato, memória da
 * empresa, skills — acha CANDIDATOS por um critério barato (vetor, palavra,
 * data). O critério barato erra a ordem: o trecho que responde a pergunta fica
 * em 7º e o agente lê só os 5 primeiros. Um modelo de rerank lê a pergunta e
 * cada candidato JUNTOS e devolve a relevância real — é a etapa que separa
 * "achou algo parecido" de "achou a resposta".
 *
 * ## O contrato, que é o que importa
 *
 * `reordenar` NUNCA lança e NUNCA atrasa a resposta além do teto. Sem chave,
 * com a OpenRouter fora do ar, com timeout, com resposta malformada: devolve
 * `null` e quem chamou segue com a ordem que já tinha. A busca nunca piora por
 * causa desta etapa — no pior caso, ela não melhora.
 *
 * ## De onde vem a chave (decisão do produto, 2026-11-17)
 *
 *  1. A credencial OpenRouter da organização (Credenciais) — quem usa paga.
 *  2. `OPENROUTER_API_KEY` da instalação.
 *  3. Nada: devolve `null`, e a busca segue sem reordenar.
 *
 * O modelo vem de `RERANK_MODEL` (padrão `voyageai/rerank-2.5-lite`). Não é um
 * ponto configurável no painel: modelos de rerank não estão no catálogo de
 * modelos de conversa, e oferecer a lista de lá faria o operador escolher um
 * modelo que a OpenRouter recusa nesta rota — com a busca degradando em
 * silêncio. Ver o ponto `rerank` em `lib/ai/pontos/registro.ts`.
 *
 * ## Por onde sai
 *
 * Pela mesma allowlist de egress do motor (`allowlistedFetch`): o único host
 * alcançável é o da OpenRouter, e redirect para fora é bloqueado.
 */
import { allowlistedFetch, buildAllowlist } from "@/lib/agent-engine/edge/egress";
import { cabecalhosDeAtribuicaoOpenRouter } from "@/lib/agent-engine/edge/llm/providers";
import { OPENROUTER_BASE_URL } from "@/lib/ai/gateway";
import { credencialDaOrganizacao } from "@/lib/ai/embeddings/chave";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { createAdminClient } from "@/lib/supabase/admin";

export const MODELO_DE_RERANK_PADRAO = "voyageai/rerank-2.5-lite";

/** Teto de espera. Acima disso a busca segue sem reordenar. */
export const TIMEOUT_DO_RERANK_MS = 1_500;

/** Quantos candidatos, no máximo, vão ao modelo numa chamada. */
export const MAXIMO_DE_CANDIDATOS = 50;

/** Cada documento é cortado aqui: rerank mede relevância, não precisa do texto inteiro. */
const MAXIMO_DE_CARACTERES_POR_DOCUMENTO = 2_000;

/** Onde a reordenação é usada — vira o `purpose` em `llm_calls` (`rerank:<ponto>`). */
export type PontoDeRerank = "material" | "produtos" | "notas" | "memoria" | "skills";

export interface ItemReordenado {
  /** Posição do documento na lista de entrada. */
  indice: number;
  /** Relevância devolvida pelo modelo (0..1 nos modelos atuais). */
  relevancia: number;
}

export interface ChaveDeRerank {
  apiKey: string;
  origem: "credencial_openrouter_da_organizacao" | "chave_openrouter_da_instalacao";
}

export interface DepsDoRerank {
  /** Injeção para teste — o padrão lê credencial da org e o `.env`. */
  resolverChave?: (organizationId: string) => Promise<ChaveDeRerank | null>;
  fetchImpl?: typeof fetch;
  registrar?: (linha: LinhaDeTelemetria) => void;
  agora?: () => number;
}

export interface LinhaDeTelemetria {
  organizationId: string;
  ponto: PontoDeRerank;
  modelo: string;
  documentos: number;
  tokensEstimados: number;
  custoCentavos: number;
  latenciaMs: number;
  erro: string | null;
}

export function modeloDeRerank(): string {
  return env.RERANK_MODEL.trim() || MODELO_DE_RERANK_PADRAO;
}

export function rerankDesligado(): boolean {
  const v = env.RERANK_DESLIGADO.trim().toLowerCase();
  return v === "1" || v === "true" || v === "sim";
}

export async function resolverChaveDeRerank(organizationId: string): Promise<ChaveDeRerank | null> {
  const daOrg = await credencialDaOrganizacao(organizationId, "openrouter");
  if (daOrg?.apiKey) return { apiKey: daOrg.apiKey, origem: "credencial_openrouter_da_organizacao" };
  if (env.OPENROUTER_API_KEY) return { apiKey: env.OPENROUTER_API_KEY, origem: "chave_openrouter_da_instalacao" };
  return null;
}

/**
 * Lê a resposta da OpenRouter. Pura e exportada para teste.
 *
 * Aceita só o que faz sentido: índice inteiro dentro da lista, relevância
 * finita, sem índice repetido. Qualquer outra coisa invalida a resposta INTEIRA
 * — uma ordem meio certa é pior que a ordem original, porque parece confiável.
 */
export function lerResposta(corpo: unknown, total: number): { itens: ItemReordenado[]; custoUsd: number | null } | null {
  if (corpo === null || typeof corpo !== "object") return null;
  const resultados = (corpo as { results?: unknown }).results;
  if (!Array.isArray(resultados) || resultados.length === 0) return null;
  const vistos = new Set<number>();
  const itens: ItemReordenado[] = [];
  for (const r of resultados) {
    if (r === null || typeof r !== "object") return null;
    const indice = (r as { index?: unknown }).index;
    const relevancia = (r as { relevance_score?: unknown }).relevance_score;
    if (typeof indice !== "number" || !Number.isInteger(indice) || indice < 0 || indice >= total) return null;
    if (typeof relevancia !== "number" || !Number.isFinite(relevancia)) return null;
    if (vistos.has(indice)) return null;
    vistos.add(indice);
    itens.push({ indice, relevancia });
  }
  itens.sort((a, b) => b.relevancia - a.relevancia);
  const custo = (corpo as { usage?: { cost?: unknown } }).usage?.cost;
  return { itens, custoUsd: typeof custo === "number" && Number.isFinite(custo) ? custo : null };
}

/** Estimativa grosseira de tokens (4 caracteres ≈ 1 token) — só para custo quando a resposta não traz. */
function estimarTokens(query: string, documentos: readonly string[]): number {
  const chars = query.length * documentos.length + documentos.reduce((s, d) => s + d.length, 0);
  return Math.ceil(chars / 4);
}

/** US$ 0,05 por milhão de tokens — preço público do modelo padrão. Só estimativa de fallback. */
const USD_POR_TOKEN_ESTIMADO = 0.05 / 1_000_000;

/**
 * Reordena `documentos` pela relevância para `query`.
 *
 * Devolve `null` (a ordem original vale) quando: a reordenação está desligada,
 * há menos de 2 documentos, não há chave, ou a chamada falhou de qualquer jeito.
 */
export async function reordenar(
  args: {
    organizationId: string;
    query: string;
    documentos: readonly string[];
    topN?: number;
    ponto: PontoDeRerank;
  },
  deps: DepsDoRerank = {},
): Promise<ItemReordenado[] | null> {
  const query = args.query.trim();
  if (rerankDesligado() || query === "" || args.documentos.length < 2) return null;

  const documentos = args.documentos
    .slice(0, MAXIMO_DE_CANDIDATOS)
    .map((d) => d.slice(0, MAXIMO_DE_CARACTERES_POR_DOCUMENTO));
  const resolver = deps.resolverChave ?? resolverChaveDeRerank;
  const registrar = deps.registrar ?? registrarNoLlmCalls;
  const agora = deps.agora ?? Date.now;
  const modelo = modeloDeRerank();

  let chave: ChaveDeRerank | null;
  try {
    chave = await resolver(args.organizationId);
  } catch {
    return null;
  }
  if (!chave) return null;

  const inicio = agora();
  const base = (env.OPENROUTER_BASE_URL.trim() || OPENROUTER_BASE_URL).replace(/\/+$/, "");
  const tokensEstimados = estimarTokens(query, documentos);
  const telemetria = (erro: string | null, custoUsd: number | null) =>
    registrar({
      organizationId: args.organizationId,
      ponto: args.ponto,
      modelo,
      documentos: documentos.length,
      tokensEstimados,
      custoCentavos: (custoUsd ?? tokensEstimados * USD_POR_TOKEN_ESTIMADO) * 100,
      latenciaMs: agora() - inicio,
      erro,
    });

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TIMEOUT_DO_RERANK_MS);
  try {
    const res = await allowlistedFetch(
      `${base}/rerank`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${chave.apiKey}`,
          "content-type": "application/json",
          ...(cabecalhosDeAtribuicaoOpenRouter() ?? {}),
        },
        body: JSON.stringify({
          model: modelo,
          query: query.slice(0, MAXIMO_DE_CARACTERES_POR_DOCUMENTO),
          documents: documentos,
          ...(args.topN ? { top_n: Math.min(args.topN, documentos.length) } : {}),
        }),
        signal: controle.signal,
      },
      { allowlist: buildAllowlist([base]), ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}) },
    );
    if (!res.ok) {
      telemetria(`http_${res.status}`, 0);
      return null;
    }
    const lido = lerResposta(await res.json(), documentos.length);
    if (!lido) {
      telemetria("resposta_invalida", 0);
      return null;
    }
    telemetria(null, lido.custoUsd);
    return lido.itens;
  } catch (err) {
    const abortou = err instanceof Error && err.name === "AbortError";
    telemetria(abortou ? "timeout" : "falha_de_rede", 0);
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Fire-and-forget em `llm_calls`, com o mesmo molde de `lib/ai/log-invocation.ts`:
 * perder a linha de telemetria é infinitamente melhor que atrasar a busca.
 */
function registrarNoLlmCalls(l: LinhaDeTelemetria): void {
  queueMicrotask(() => {
    void (async () => {
      try {
        const { error } = await createAdminClient().from("llm_calls").insert({
          organization_id: l.organizationId,
          purpose: `rerank:${l.ponto}`,
          provider: "openrouter",
          model: l.modelo,
          input_tokens: l.tokensEstimados,
          output_tokens: 0,
          cost_cents: l.custoCentavos,
          latency_ms: l.latenciaMs,
          status: l.erro ? "erro" : "ok",
          error_code: l.erro,
          error_message: l.erro,
        });
        if (error) logger.warn("[rerank] telemetria não gravada", { motivo: error.message });
      } catch (err) {
        logger.warn("[rerank] telemetria não gravada", {
          motivo: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

/**
 * Aplica a reordenação a uma lista de itens — o atalho que os chamadores usam.
 *
 * Devolve os itens na ordem nova, cada um com `relevancia`, e corta em `topN`.
 * Item que o modelo não devolveu (quando `top_n` corta) fica de fora: o modelo
 * disse que ele é menos relevante que os N devolvidos. Sem reordenação, devolve
 * os itens como vieram (cortados em `topN`) e `reordenado: false`.
 */
export async function reordenarItens<T extends object>(
  args: {
    organizationId: string;
    query: string;
    itens: readonly T[];
    texto: (item: T) => string;
    topN: number;
    ponto: PontoDeRerank;
  },
  deps?: DepsDoRerank,
): Promise<{ itens: Array<T & { relevancia: number | null }>; reordenado: boolean }> {
  const candidatos = args.itens.slice(0, MAXIMO_DE_CANDIDATOS);
  const ordem = await reordenar(
    {
      organizationId: args.organizationId,
      query: args.query,
      documentos: candidatos.map(args.texto),
      topN: args.topN,
      ponto: args.ponto,
    },
    deps,
  );
  if (!ordem) {
    return { itens: args.itens.slice(0, args.topN).map((i) => ({ ...i, relevancia: null })), reordenado: false };
  }
  return {
    itens: ordem.slice(0, args.topN).map((o) => ({ ...(candidatos[o.indice] as T), relevancia: o.relevancia })),
    reordenado: true,
  };
}
