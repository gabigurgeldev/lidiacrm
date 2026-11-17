/**
 * A FUSÃO DAS DUAS BUSCAS (vetor + texto) E O CORTE FINAL.
 *
 * O vetor acha o que é PARECIDO com a pergunta ("como faço para trocar?" ↔
 * "política de trocas"). O texto acha o que é IGUAL ("AB-1234", "49,90"). Cada
 * um devolve uma lista ordenada pelo seu próprio critério — e os dois scores não
 * são comparáveis (cosseno não é rank de tsvector).
 *
 * Por isso a fusão usa só a POSIÇÃO em cada lista: Reciprocal Rank Fusion,
 * `soma de 1 / (60 + posição)`. Trecho que aparece bem nas duas sobe; trecho que
 * só uma acha entra, mais abaixo. É o padrão da indústria justamente por não
 * exigir calibrar scores.
 *
 * Tudo aqui é puro — o teste exercita sem banco.
 */

/** Constante clássica do RRF: amortece a diferença entre o 1º e o 2º lugar. */
export const K_DO_RRF = 60;

/** Quantos candidatos por lista o banco devolve, para a fusão ter de onde escolher. */
export function candidatosPorLista(topK: number): number {
  return Math.min(Math.max(topK * 4, 20), 60);
}

/** Quantos candidatos fundidos vão ao rerank. */
export const CANDIDATOS_PARA_O_RERANK = 30;

/**
 * Piso de relevância do rerank. Abaixo disso o modelo está dizendo "não tem a
 * ver com a pergunta" — e mandar ao agente um trecho sem relação é o que faz
 * ele inventar uma ponte entre a pergunta e o texto.
 */
export const PISO_DO_RERANK = 0.15;

/**
 * Palavras que aparecem em toda pergunta e não ajudam a achar nada. A lista é
 * curta de propósito: o rerank resolve o resto, e uma lista longa começa a
 * engolir termo de produto.
 */
const PALAVRAS_VAZIAS = new Set([
  "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos",
  "em", "na", "no", "nas", "nos", "por", "para", "pra", "pro", "com", "sem", "e",
  "ou", "que", "se", "me", "te", "eu", "voce", "voces", "vc", "vcs", "ele", "ela",
  "isso", "esse", "essa", "este", "esta", "ai", "la", "qual", "quais", "quanto",
  "como", "onde", "quando", "tem", "ter", "tenho", "vou", "quero", "queria",
  "gostaria", "saber", "sobre", "mais", "muito", "bom", "boa", "dia", "tarde",
  "noite", "oi", "ola", "obrigado", "obrigada", "por", "favor", "ja", "nao", "sim",
  "ta", "to", "esta", "estou", "sao", "ser", "foi", "era", "seu", "sua", "meu",
  "minha", "the", "and",
]);

/** Remove acento e caixa — o MESMO `translate` da coluna `ai_chunks.tsv` (0255). */
export function normalizarParaBusca(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Os termos que vão ao `tsquery`. Só `[a-z0-9]`, de 2 a 40 caracteres — a
 * função SQL confere de novo, mas é aqui que o texto do cliente deixa de poder
 * carregar operador de tsquery. Hífen e ponto separam ("AB-1234" vira "ab" e
 * "1234", e o código colado "ab1234" também entra).
 */
export function termosDaBusca(pergunta: string, maximo = 12): string[] {
  const normal = normalizarParaBusca(pergunta);
  const termos = new Set<string>();
  for (const bruto of normal.split(/[^a-z0-9.,-]+/)) {
    if (!bruto) continue;
    const colado = bruto.replace(/[.,-]/g, "");
    if (/[0-9]/.test(colado) && colado.length >= 2 && colado.length <= 40) termos.add(colado);
    for (const parte of bruto.split(/[.,-]+/)) {
      if (parte.length < 2 || parte.length > 40) continue;
      if (PALAVRAS_VAZIAS.has(parte)) continue;
      termos.add(parte);
    }
  }
  return [...termos].slice(0, maximo);
}

export interface CandidatoComPosicao {
  chunk_id: string;
  rank_vetor: number | null;
  rank_texto: number | null;
}

/**
 * RRF sobre as duas posições. Candidato repetido (veio de dois mapas de
 * embedding durante uma troca de modelo) fica com a MELHOR posição de cada
 * lista. Empate desempata pelo vetor, depois pelo id — ordem determinística.
 */
export function fundirPorRrf<T extends CandidatoComPosicao>(candidatos: readonly T[]): Array<T & { rrf: number }> {
  const porId = new Map<string, T>();
  for (const c of candidatos) {
    const atual = porId.get(c.chunk_id);
    if (!atual) {
      porId.set(c.chunk_id, c);
      continue;
    }
    porId.set(c.chunk_id, {
      ...atual,
      rank_vetor: melhor(atual.rank_vetor, c.rank_vetor),
      rank_texto: melhor(atual.rank_texto, c.rank_texto),
    });
  }
  return [...porId.values()]
    .map((c) => ({
      ...c,
      rrf:
        (c.rank_vetor ? 1 / (K_DO_RRF + c.rank_vetor) : 0) +
        (c.rank_texto ? 1 / (K_DO_RRF + c.rank_texto) : 0),
    }))
    .sort(
      (a, b) =>
        b.rrf - a.rrf ||
        (a.rank_vetor ?? Number.MAX_SAFE_INTEGER) - (b.rank_vetor ?? Number.MAX_SAFE_INTEGER) ||
        a.chunk_id.localeCompare(b.chunk_id),
    );
}

function melhor(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * O corte final — o que vai ao agente.
 *
 * - Com rerank: os `topK` de maior relevância, desde que acima de
 *   `PISO_DO_RERANK`. O limiar de similaridade do agente não se aplica aqui:
 *   ele foi calibrado para cosseno, e o rerank já mediu relevância de verdade.
 * - Sem rerank: o que o vetor aprova (`similarity >= limiar`) OU o que o texto
 *   achou (todo termo da pergunta que casou é sinal forte — código e SKU), na
 *   ordem do RRF.
 */
export function cortar<T extends { similarity: number; rank_texto: number | null; relevancia: number | null }>(
  fundidos: readonly T[],
  args: { topK: number; limiar: number; reordenado: boolean },
): T[] {
  const aprovados = args.reordenado
    ? fundidos.filter((f) => (f.relevancia ?? 0) >= PISO_DO_RERANK)
    : fundidos.filter((f) => (Number.isFinite(f.similarity) && f.similarity >= args.limiar) || (f.rank_texto !== null && f.rank_texto <= args.topK));
  return aprovados.slice(0, Math.max(args.topK, 0));
}
