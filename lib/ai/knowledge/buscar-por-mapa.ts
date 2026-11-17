/**
 * A BUSCA NO MATERIAL QUANDO O ACERVO ESTÁ EM DOIS MODELOS.
 *
 * Depois de uma troca de modelo de embedding, os materiais são reindexados um
 * a um. Até o último terminar, parte do acervo está no mapa novo e parte no
 * antigo — e um vetor de pergunta só se compara com trechos do MESMO mapa.
 * Buscar tudo com o modelo novo faria o material antigo "sumir" durante a
 * reindexação, sem erro nenhum: exatamente a falha que o agente não sabe
 * contar ao cliente.
 *
 * Então a busca agrupa os materiais pelo mapa da versão ativa de cada um,
 * embeda a pergunta UMA vez por mapa (com a chave que serve aquele mapa) e
 * funde os resultados por similaridade. No estado normal há um mapa só — custo
 * e latência iguais aos de antes.
 *
 * O executor é uma interface porque os três chamadores falam bancos diferentes
 * (`pg.Pool` no engine, Supabase no worker e no MCP); a regra é uma só.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { embedText, SemChaveDeEmbeddingError } from "@/lib/ai/embed";
import { MAPA_LEGADO } from "@/lib/ai/embeddings/catalogo";
import { resolverChaveParaMapa } from "@/lib/ai/embeddings/chave";
import {
  CANDIDATOS_PARA_O_RERANK,
  candidatosPorLista,
  cortar,
  fundirPorRrf,
  termosDaBusca,
} from "@/lib/ai/knowledge/fusao";
import { reordenarItens, type DepsDoRerank } from "@/lib/ai/rerank/openrouter";

/** A linha que a busca híbrida devolve: a do caminho antigo mais as posições. */
export type LinhaHibrida<T> = T & {
  chunk_id: string;
  content: string;
  rank_vetor: number | null;
  rank_texto: number | null;
};

export interface ExecutorDeBusca<T extends { similarity: number }> {
  /** O mapa da versão ativa de cada material (material sem versão fica de fora). */
  mapasDasFontes(fontes: readonly string[]): Promise<Map<string, string>>;
  /** A RPC `fn_buscar_trechos_das_fontes` restrita a um mapa. */
  buscar(fontes: readonly string[], vetor: string, k: number, mapa: string): Promise<T[]>;
  /**
   * A RPC `fn_buscar_trechos_hibrido` (0255): candidatos do vetor E do texto,
   * com a posição em cada lista. Quando o executor a oferece, a busca é híbrida
   * — fusão RRF e rerank — e o resultado já sai CORTADO (`cortado: true`).
   */
  buscarHibrido?(
    fontes: readonly string[],
    vetor: string,
    termos: readonly string[],
    k: number,
    mapa: string,
  ): Promise<Array<LinhaHibrida<T>>>;
}

export interface DepsDaBusca {
  embed?: typeof embedText;
  chaveDoMapa?: typeof resolverChaveParaMapa;
  rerank?: DepsDoRerank;
}

/** O que a busca híbrida conta a mais, para telemetria e rastro. */
export interface DiagnosticoDaBusca {
  /** Candidatos depois da fusão (antes do corte). */
  candidatos: number;
  /** O rerank respondeu e a ordem final é a dele. */
  reordenado: boolean;
  /** Termos que foram ao tsquery. */
  termos: string[];
}

export interface ResultadoDaBuscaPorMapa<T> {
  hits: T[];
  mapasSemChave: string[];
  /** true = `hits` já é o conjunto final (híbrida). false = o chamador corta pelo limiar. */
  cortado: boolean;
  /** Melhor similaridade entre TODOS os candidatos (para `top_score`). */
  melhorSimilaridade: number | null;
  diagnostico: DiagnosticoDaBusca | null;
}

/** Materiais por mapa, na ordem em que aparecem. Puro. */
export function agruparPorMapa(fontes: readonly string[], mapas: ReadonlyMap<string, string>): Map<string, string[]> {
  const grupos = new Map<string, string[]>();
  for (const f of fontes) {
    const mapa = mapas.get(f);
    if (!mapa) continue;
    const g = grupos.get(mapa);
    if (g) g.push(f);
    else grupos.set(mapa, [f]);
  }
  return grupos;
}

/** Os K melhores entre todos os grupos. Puro. NaN (embedding zerado) vai ao fim. */
export function fundirResultados<T extends { similarity: number }>(listas: readonly T[][], k: number): T[] {
  const valor = (s: number) => (Number.isFinite(s) ? s : Number.NEGATIVE_INFINITY);
  return listas
    .flat()
    .sort((a, b) => valor(b.similarity) - valor(a.similarity))
    .slice(0, Math.max(k, 0));
}

export async function buscarPorMapa<T extends { similarity: number }>(args: {
  organizationId: string;
  fontes: readonly string[];
  query: string;
  k: number;
  executor: ExecutorDeBusca<T>;
  deps?: DepsDaBusca;
  /**
   * Limiar de similaridade do agente. Só vale na busca híbrida SEM rerank — no
   * caminho antigo quem corta continua sendo o chamador.
   */
  limiar?: number;
}): Promise<ResultadoDaBuscaPorMapa<T>> {
  const embed = args.deps?.embed ?? embedText;
  const chaveDoMapa = args.deps?.chaveDoMapa ?? resolverChaveParaMapa;

  const grupos = agruparPorMapa(args.fontes, await args.executor.mapasDasFontes(args.fontes));
  const buscarHibrido = args.executor.buscarHibrido?.bind(args.executor);
  const termos = buscarHibrido ? termosDaBusca(args.query) : [];
  const listas: T[][] = [];
  const mapasSemChave: string[] = [];

  for (const [mapa, fontes] of grupos) {
    const chave = await chaveDoMapa(args.organizationId, mapa);
    if (!chave) {
      mapasSemChave.push(mapa);
      continue;
    }
    const { embedding } = await embed(args.query, {
      organizationId: args.organizationId,
      ponto: "embedding_consultar",
      chave,
    });
    const vetor = `[${embedding.join(",")}]`;
    listas.push(
      buscarHibrido
        ? await buscarHibrido(fontes, vetor, termos, candidatosPorLista(args.k), mapa)
        : await args.executor.buscar(fontes, vetor, args.k, mapa),
    );
  }

  // Sem chave para NENHUM mapa é o estado "sem chave" de sempre: quem chama já
  // sabe transformar isso na frase certa para o modelo.
  if (grupos.size > 0 && listas.length === 0) throw new SemChaveDeEmbeddingError(args.organizationId);

  const maior = Math.max(...listas.flat().map((t) => t.similarity).filter(Number.isFinite));
  const melhorSimilaridade = Number.isFinite(maior) ? maior : null;

  if (!buscarHibrido) {
    return { hits: fundirResultados(listas, args.k), mapasSemChave, cortado: false, melhorSimilaridade, diagnostico: null };
  }

  // Busca híbrida: funde pelas posições (RRF), reordena os melhores pela
  // relevância real (rerank) e corta. Sem rerank (sem chave, timeout), o corte
  // usa o limiar do agente para o vetor e aceita o que o texto achou no topo.
  const fundidos = fundirPorRrf(listas.flat() as Array<LinhaHibrida<T>>);
  const { itens, reordenado } = await reordenarItens(
    {
      organizationId: args.organizationId,
      query: args.query,
      itens: fundidos.slice(0, CANDIDATOS_PARA_O_RERANK),
      texto: (l) => l.content,
      topN: Math.max(args.k, 1),
      ponto: "material",
    },
    args.deps?.rerank,
  );
  const hits = cortar(itens, { topK: args.k, limiar: args.limiar ?? -1, reordenado });
  return {
    hits: hits as unknown as T[],
    mapasSemChave,
    cortado: true,
    melhorSimilaridade,
    diagnostico: { candidatos: fundidos.length, reordenado, termos },
  };
}

interface LinhaDaRpcDeFontes {
  chunk_id: string;
  knowledge_source_id: string | null;
  source_name: string | null;
  content: string;
  similarity: number;
  metadata?: Record<string, unknown> | null;
}

/**
 * O executor para quem fala Supabase (MCP, worker legado). O cliente pode ser
 * o de sessão (RLS) ou o admin — por isso o filtro de organização é explícito
 * nas duas leituras, como exige o anti-pattern 10.
 */
export function executorSupabase(
  supabase: SupabaseClient,
  organizationId: string,
  piso: number,
  opcoes?: { hibrida?: boolean },
): ExecutorDeBusca<LinhaDaRpcDeFontes> {
  const executor: ExecutorDeBusca<LinhaDaRpcDeFontes> = {
    async mapasDasFontes(fontes) {
      const { data: linhas } = await supabase
        .from("ai_knowledge_sources")
        .select("id, active_kb_version_id")
        .eq("organization_id", organizationId)
        .in("id", [...fontes]);
      const porFonte = ((linhas ?? []) as Array<{ id: string; active_kb_version_id: string | null }>).filter(
        (l) => l.active_kb_version_id !== null,
      );
      const mapas = new Map<string, string>();
      if (porFonte.length === 0) return mapas;
      const { data: versoes } = await supabase
        .from("ai_knowledge_versions")
        .select("id, embedding_model")
        .eq("organization_id", organizationId)
        .in(
          "id",
          porFonte.map((l) => l.active_kb_version_id as string),
        );
      const mapaDaVersao = new Map(
        ((versoes ?? []) as Array<{ id: string; embedding_model: string | null }>).map((v) => [
          v.id,
          v.embedding_model ?? MAPA_LEGADO,
        ]),
      );
      for (const l of porFonte) mapas.set(l.id, mapaDaVersao.get(l.active_kb_version_id as string) ?? MAPA_LEGADO);
      return mapas;
    },
    async buscar(fontes, vetor, k, mapa) {
      const { data, error } = await supabase.rpc("fn_buscar_trechos_das_fontes", {
        p_organization_id: organizationId,
        p_source_ids: [...fontes],
        p_embedding: vetor,
        p_k: k,
        p_threshold: piso,
        p_embedding_model: mapa,
      });
      if (error) throw new Error(`busca_de_conhecimento_falhou: ${error.message}`);
      return (data ?? []) as LinhaDaRpcDeFontes[];
    },
  };
  if (opcoes?.hibrida) {
    executor.buscarHibrido = async (fontes, vetor, termos, k, mapa) => {
      const { data, error } = await supabase.rpc("fn_buscar_trechos_hibrido" as never, {
        p_organization_id: organizationId,
        p_source_ids: [...fontes],
        p_embedding: vetor,
        p_termos: [...termos],
        p_k: k,
        p_embedding_model: mapa,
      } as never);
      if (error) throw new Error(`busca_de_conhecimento_falhou: ${(error as { message: string }).message}`);
      return (data ?? []) as Array<LinhaHibrida<LinhaDaRpcDeFontes>>;
    };
  }
  return executor;
}

/** A consulta da busca híbrida no `pg.Pool` (engine). Mesmas colunas da RPC. */
export const SQL_BUSCA_HIBRIDA = `select chunk_id, knowledge_source_id, source_name, content, similarity, metadata,
       rank_vetor, rank_texto
  from fn_buscar_trechos_hibrido($1, $2::uuid[], $3::vector, $4::text[], $5, $6)`;

/** A consulta que lê o mapa da versão ativa de cada material (SQL do `pg.Pool`). */
export const SQL_MAPAS_DAS_FONTES = `select s.id, coalesce(v.embedding_model, $3) as mapa
  from ai_knowledge_sources s
  join ai_knowledge_versions v on v.id = s.active_kb_version_id
 where s.organization_id = $1 and s.id = any($2::uuid[])`;
