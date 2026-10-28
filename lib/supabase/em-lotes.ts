/**
 * `.in()` EM LOTES — a lista de ids viaja na URL, e a URL tem teto.
 *
 * O PostgREST recebe o filtro como `?coluna=in.(id1,id2,…)` na query string.
 * Cada UUID custa ~39 bytes ali (36 caracteres + a vírgula codificada), e o
 * Kong da instalação responde `414 URI too long` passado o teto da linha de
 * requisição do nginx. O erro não depende do código estar errado: depende de a
 * organização CRESCER — passa em todo teste e quebra no cliente que deu certo.
 *
 * Medido em produção em 2026-10-27, no log do Kong (72 h):
 *
 *   PATCH webhook_events_log ... 37  — a poda manda 500 ids por rodada; nunca
 *                                      esvaziou uma linha desde que a base
 *                                      passou de 500 webhooks velhos
 *   GET   cron_jobs ............ 48  — radar de risco, por contato
 *   GET   crm_leads / crm_lead_scores / conversations / lead_state — o quadro
 *         de uma loja com algumas centenas de negócios não abria ("Não
 *         consegui carregar este Kanban: URI too long")
 *
 * 100 ids ≈ 4 KB: metade do teto, com folga para os demais filtros da URL.
 */
export const IDS_POR_REQUISICAO = 100;

/** Corta a lista em fatias de no máximo `tamanho`, preservando a ordem. */
export function fatiar<T>(itens: readonly T[], tamanho: number = IDS_POR_REQUISICAO): T[][] {
  if (tamanho < 1) throw new Error(`fatiar: tamanho inválido (${tamanho})`);
  const fatias: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) fatias.push(itens.slice(i, i + tamanho));
  return fatias;
}

type Resposta<R> = { data: R[] | null; error: { message: string } | null };

/**
 * Roda a mesma consulta uma vez por fatia de ids e junta as linhas.
 *
 * As linhas saem NA ORDEM DAS FATIAS, e dentro de cada fatia na ordem que o
 * banco devolveu. Quem ordena no SQL e fica com "o primeiro visto" por chave
 * (ex.: a conversa mais recente por contato) continua certo, desde que a chave
 * seja a coluna fatiada: cada chave mora numa fatia só.
 *
 * O primeiro erro vence e as linhas são descartadas — devolver metade do
 * conjunto como se fosse o todo é pior que falhar (um quadro com metade dos
 * scores parece um quadro em que metade dos leads não tem score).
 */
export async function consultarEmLotes<R>(
  ids: readonly string[],
  consulta: (lote: string[]) => PromiseLike<Resposta<R>>,
  tamanho: number = IDS_POR_REQUISICAO,
): Promise<{ data: R[]; error: { message: string } | null }> {
  const respostas = await Promise.all(fatiar(ids, tamanho).map((lote) => consulta(lote)));
  const erro = respostas.find((r) => r.error)?.error ?? null;
  if (erro) return { data: [], error: erro };
  return { data: respostas.flatMap((r) => r.data ?? []), error: null };
}
