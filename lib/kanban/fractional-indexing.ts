const STEP = 1000;

/**
 * Compute a numeric position between two siblings. Returns NaN if both args
 * are equal (caller should trigger global rebalance — Wave 8 concern).
 */
export function midpoint(prev: number | null, next: number | null): number {
  if (prev == null && next == null) return STEP;
  if (prev == null) return (next as number) - STEP;
  if (next == null) return prev + STEP;
  if (prev === next) return NaN;
  return (prev + next) / 2;
}

/**
 * Returns the fractional precision (digits after decimal) of a number.
 * Used to detect when global rebalance is needed (>20 levels per spec P-05).
 */
export function fractionalPrecision(n: number): number {
  if (!isFinite(n)) return Infinity;
  const s = Math.abs(n).toString();
  const dot = s.indexOf(".");
  if (dot < 0) return 0;
  return s.length - dot - 1;
}

/**
 * A posição para quem cai no índice `indice` de uma coluna JÁ ORDENADA (sem o
 * próprio card), sem colisão.
 *
 * `midpoint` devolve NaN quando os dois vizinhos têm a MESMA posição (cards
 * criados no mesmo instante por importação ou automação nascem empatados). O
 * board abortava o arrasto calado nesse caso: o card voltava para trás e
 * ninguém sabia por quê. Aqui o empate se resolve olhando para o próximo
 * vizinho DISTINTO — o card fica entre o de cima e o primeiro que tem posição
 * maior. Num bloco de empatados ele pode cair alguns lugares abaixo de onde foi
 * solto (depois dos empatados), mas cai na coluna certa e o movimento acontece.
 */
export function posicaoNoIndice(posicoes: readonly number[], indice: number): number {
  const antes = indice > 0 ? (posicoes[indice - 1] ?? null) : null;
  const depois = indice < posicoes.length ? (posicoes[indice] ?? null) : null;
  const m = midpoint(antes, depois);
  if (!Number.isNaN(m)) return m;
  // Empate: procura o primeiro vizinho de baixo com posição maior.
  const maior = posicoes.slice(indice).find((p) => antes !== null && p > antes);
  return maior !== undefined ? ((antes as number) + maior) / 2 : (antes as number) + STEP;
}
