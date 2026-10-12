/**
 * OS MODELOS DE EMBEDDING QUE A BUSCA NO MATERIAL ACEITA.
 *
 * ## O contrato que não muda: 1536 dimensões
 *
 * `ai_chunks.embedding` é `vector(1536)`. Todo modelo daqui entrega 1536 — ou
 * nativamente, ou encurtado pelo parâmetro de dimensão do provedor (os modelos
 * de embedding modernos são treinados para serem cortados sem perder muito).
 * Mudar a coluna para dimensão variável custaria o índice vetorial e uma
 * reindexação em toda instalação self-host; o corte por parâmetro não custa
 * nada disso.
 *
 * ## "Mapa": o que define se dois vetores são comparáveis
 *
 * Indexação e busca são coordenadas de um mesmo MAPA. Dois vetores só se
 * comparam se saíram do mesmo modelo, com o mesmo corte. O id do mapa é
 * `<fabricante>/<modelo>` mais `@1536` quando o vetor foi encurtado — e NÃO
 * depende de quem carregou a chamada: `text-embedding-3-small` pela OpenAI ou
 * pela OpenRouter é o mesmo mapa (é o mesmo modelo, servido por dois
 * endereços). É o mapa que vai para `ai_knowledge_versions.embedding_model`, e
 * é por ele que a busca escolhe com que modelo embedar a pergunta.
 *
 * O mapa legado — o único que existia até 2026-10-12 — é
 * `openai/text-embedding-3-small`, exatamente o valor que as versões antigas
 * gravaram. Quem atualiza não reindexa nada.
 *
 * ## Preço
 *
 * Centavos de dólar por milhão de tokens, para a estimativa de custo da
 * reindexação que a tela mostra ANTES de confirmar. São valores de tabela
 * pública aproximados; o custo real é o do provedor.
 */

export type ProvedorDeEmbedding = "openai" | "openrouter" | "google";

export type ParametroDeDimensao = "dimensions" | "outputDimensionality";

export interface ModeloDoCatalogo {
  mapa: string;
  rotulo: string;
  /** Para a tela: quando escolher este. */
  quandoUsar: string;
  dimsNativas: number;
  /** Como cada provedor nomeia o modelo, e se precisa do parâmetro de corte. */
  provedores: Partial<Record<ProvedorDeEmbedding, { idNoProvedor: string; parametro: ParametroDeDimensao | null }>>;
  centavosPorMilhao: number;
}

export const DIMENSOES = 1536;

export const MAPA_LEGADO = "openai/text-embedding-3-small";

export const CATALOGO_DE_EMBEDDING: readonly ModeloDoCatalogo[] = [
  {
    mapa: MAPA_LEGADO,
    rotulo: "OpenAI Text Embedding 3 Small",
    quandoUsar: "O padrão: barato, rápido e bom para a maioria dos negócios.",
    dimsNativas: 1536,
    provedores: {
      openai: { idNoProvedor: "text-embedding-3-small", parametro: null },
      openrouter: { idNoProvedor: "openai/text-embedding-3-small", parametro: null },
    },
    centavosPorMilhao: 2,
  },
  {
    mapa: "openai/text-embedding-3-large@1536",
    rotulo: "OpenAI Text Embedding 3 Large",
    quandoUsar: "Mais preciso, principalmente com material longo ou técnico. Custa cerca de 6× o padrão.",
    dimsNativas: 3072,
    provedores: {
      openai: { idNoProvedor: "text-embedding-3-large", parametro: "dimensions" },
      openrouter: { idNoProvedor: "openai/text-embedding-3-large", parametro: "dimensions" },
    },
    centavosPorMilhao: 13,
  },
  {
    mapa: "google/gemini-embedding-001@1536",
    rotulo: "Google Gemini Embedding",
    quandoUsar: "Muito bom em português e em vários idiomas ao mesmo tempo.",
    dimsNativas: 3072,
    provedores: {
      google: { idNoProvedor: "gemini-embedding-001", parametro: "outputDimensionality" },
      openrouter: { idNoProvedor: "google/gemini-embedding-001", parametro: "dimensions" },
    },
    centavosPorMilhao: 15,
  },
  {
    mapa: "openai/text-embedding-ada-002",
    rotulo: "OpenAI Ada 002 (antigo)",
    quandoUsar: "Só para quem já tem material indexado com ele em outro sistema.",
    dimsNativas: 1536,
    provedores: {
      openai: { idNoProvedor: "text-embedding-ada-002", parametro: null },
      openrouter: { idNoProvedor: "openai/text-embedding-ada-002", parametro: null },
    },
    centavosPorMilhao: 10,
  },
];

/** O modelo concreto de uma chamada: qual mapa, por qual provedor, com que id e parâmetro. */
export interface ModeloDeEmbedding {
  mapa: string;
  provedor: ProvedorDeEmbedding;
  idNoProvedor: string;
  parametro: ParametroDeDimensao | null;
  /** `false` = id digitado à mão, aceito porque a prova de 1536 passou. */
  doCatalogo: boolean;
}

export const PROVEDORES_DE_EMBEDDING: readonly ProvedorDeEmbedding[] = ["openai", "openrouter", "google"];

export function ehProvedorDeEmbedding(p: string): p is ProvedorDeEmbedding {
  return (PROVEDORES_DE_EMBEDDING as readonly string[]).includes(p);
}

/** Do catálogo: o modelo que um provedor serve com aquele id. */
export function modeloDoCatalogo(provedor: string, idNoProvedor: string): ModeloDeEmbedding | null {
  if (!ehProvedorDeEmbedding(provedor)) return null;
  for (const m of CATALOGO_DE_EMBEDDING) {
    const p = m.provedores[provedor];
    if (p && p.idNoProvedor === idNoProvedor) {
      return { mapa: m.mapa, provedor, idNoProvedor, parametro: p.parametro, doCatalogo: true };
    }
  }
  return null;
}

/**
 * Id fora do catálogo. Só existe porque passou na prova de 1536 ao salvar
 * (`provarModeloDeEmbedding`), sempre COM o parâmetro de corte — então o mapa
 * leva `@1536`. A OpenAI nomeia sem fabricante, e o mapa recebe `openai/`.
 */
export function modeloProprio(provedor: ProvedorDeEmbedding, idNoProvedor: string): ModeloDeEmbedding {
  const base = provedor === "openai" ? `openai/${idNoProvedor}` : provedor === "google" ? `google/${idNoProvedor}` : idNoProvedor;
  return {
    mapa: `${base}@${DIMENSOES}`,
    provedor,
    idNoProvedor,
    parametro: provedor === "google" ? "outputDimensionality" : "dimensions",
    doCatalogo: false,
  };
}

/**
 * O modelo que o binding do painel escolheu, ou `null` quando o binding não
 * escolhe modelo (só chave — o formato de antes, que segue valendo como "mapa
 * legado com esta chave"). Id que nem parece de embedding é tratado assim
 * também: bindings antigos podiam carregar um modelo de conversa no campo.
 */
export function modeloDoBinding(binding: { provider: string; model_id: string } | null): ModeloDeEmbedding | null {
  if (binding === null || !ehProvedorDeEmbedding(binding.provider)) return null;
  const doCatalogo = modeloDoCatalogo(binding.provider, binding.model_id);
  if (doCatalogo) return doCatalogo;
  if (!/embed/i.test(binding.model_id)) return null;
  return modeloProprio(binding.provider, binding.model_id);
}

/**
 * Como embedar no mapa `mapa` usando o provedor `provedor` — para a busca
 * achar material que ainda está num mapa ANTIGO enquanto a reindexação anda.
 * `null` = esse provedor não serve esse mapa.
 */
export function modeloDoMapa(mapa: string, provedor: ProvedorDeEmbedding): ModeloDeEmbedding | null {
  const m = CATALOGO_DE_EMBEDDING.find((c) => c.mapa === mapa);
  if (m) {
    const p = m.provedores[provedor];
    return p ? { mapa, provedor, idNoProvedor: p.idNoProvedor, parametro: p.parametro, doCatalogo: true } : null;
  }
  // Mapa de modelo próprio: `<base>@1536`. Só o provedor que o nomeia serve.
  const base = mapa.replace(/@\d+$/, "");
  if (provedor === "openai" && base.startsWith("openai/")) return modeloProprio("openai", base.slice("openai/".length));
  if (provedor === "google" && base.startsWith("google/")) return modeloProprio("google", base.slice("google/".length));
  if (provedor === "openrouter") return modeloProprio("openrouter", base);
  return null;
}

/** Provedores que conseguem embedar num mapa, na ordem de preferência. */
export function provedoresDoMapa(mapa: string): ProvedorDeEmbedding[] {
  return PROVEDORES_DE_EMBEDDING.filter((p) => modeloDoMapa(mapa, p) !== null);
}

export function precoDoMapa(mapa: string): number | null {
  return CATALOGO_DE_EMBEDDING.find((c) => c.mapa === mapa)?.centavosPorMilhao ?? null;
}

export function rotuloDoMapa(mapa: string): string {
  return CATALOGO_DE_EMBEDDING.find((c) => c.mapa === mapa)?.rotulo ?? mapa;
}
