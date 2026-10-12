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

export interface ExecutorDeBusca<T extends { similarity: number }> {
  /** O mapa da versão ativa de cada material (material sem versão fica de fora). */
  mapasDasFontes(fontes: readonly string[]): Promise<Map<string, string>>;
  /** A RPC `fn_buscar_trechos_das_fontes` restrita a um mapa. */
  buscar(fontes: readonly string[], vetor: string, k: number, mapa: string): Promise<T[]>;
}

export interface DepsDaBusca {
  embed?: typeof embedText;
  chaveDoMapa?: typeof resolverChaveParaMapa;
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
}): Promise<{ hits: T[]; mapasSemChave: string[] }> {
  const embed = args.deps?.embed ?? embedText;
  const chaveDoMapa = args.deps?.chaveDoMapa ?? resolverChaveParaMapa;

  const grupos = agruparPorMapa(args.fontes, await args.executor.mapasDasFontes(args.fontes));
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
    listas.push(await args.executor.buscar(fontes, `[${embedding.join(",")}]`, args.k, mapa));
  }

  // Sem chave para NENHUM mapa é o estado "sem chave" de sempre: quem chama já
  // sabe transformar isso na frase certa para o modelo.
  if (grupos.size > 0 && listas.length === 0) throw new SemChaveDeEmbeddingError(args.organizationId);

  return { hits: fundirResultados(listas, args.k), mapasSemChave };
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
): ExecutorDeBusca<LinhaDaRpcDeFontes> {
  return {
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
}

/** A consulta que lê o mapa da versão ativa de cada material (SQL do `pg.Pool`). */
export const SQL_MAPAS_DAS_FONTES = `select s.id, coalesce(v.embedding_model, $3) as mapa
  from ai_knowledge_sources s
  join ai_knowledge_versions v on v.id = s.active_kb_version_id
 where s.organization_id = $1 and s.id = any($2::uuid[])`;
