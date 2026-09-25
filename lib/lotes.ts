/**
 * Listas grandes em pedaços — para o PostgREST e para o banco.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 *
 * Um `.in("id", ids)` vira QUERY STRING: cada UUID custa ~37 caracteres na URL,
 * e o proxy recusa a requisição bem antes de 1.000 deles. Enquanto o disparo
 * tinha teto de 500 destinatários, a conta fechava por pouco; sem o teto, uma
 * planilha grande quebraria na primeira consulta com um erro que não diz nada
 * sobre tamanho.
 *
 * O mesmo vale para o insert em massa (corpo grande demais numa só ida) e para a
 * leitura (o PostgREST corta em 1.000 linhas por padrão, em silêncio).
 */

/** Tamanho seguro de um `.in()` de UUIDs: ~7 KB de URL, longe de qualquer teto de proxy. */
export const LOTE_DE_FILTRO = 150;
/** Linhas por insert em massa. */
export const LOTE_DE_INSERT = 500;
/** Linhas por página de leitura — o teto padrão do PostgREST. */
export const PAGINA_DE_LEITURA = 1000;

export function emLotes<T>(itens: readonly T[], tamanho: number): T[][] {
  if (tamanho < 1) throw new Error("emLotes: tamanho precisa ser >= 1");
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/**
 * Roda `fn` sobre todos os itens com no máximo `limite` ao mesmo tempo, e devolve
 * os resultados NA ORDEM dos itens.
 *
 * Sequencial, uma importação de milhares de contatos passava minutos esperando
 * ida e volta; tudo de uma vez abriria milhares de conexões contra o banco da
 * VPS. O meio-termo é um punhado de trabalhadores puxando da mesma fila.
 */
export async function comConcorrencia<T, R>(
  itens: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await fn(itens[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}
