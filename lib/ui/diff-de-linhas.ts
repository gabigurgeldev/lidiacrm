/**
 * Diff linha a linha de dois textos (LCS por programação dinâmica). Puro.
 *
 * Usado onde se compara prompt de agente: o histórico de versões
 * (`VersionDiff.tsx`) e a correção com IA (`DiffDaCorrecao.tsx`). Morava dentro
 * do `VersionDiff`; saiu daqui para as duas telas mostrarem o MESMO diff.
 *
 * Texto acima de `TETO_DE_LINHAS` não é comparado linha a linha (a tabela da
 * programação dinâmica é m×n): volta como "tudo saiu, tudo entrou".
 */
export type LinhaDoDiff = { kind: "ctx" | "add" | "del"; text: string };

export const TETO_DE_LINHAS = 600;

export function diffDeLinhas(a: string, b: string): LinhaDoDiff[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const m = A.length;
  const n = B.length;
  if (m > TETO_DE_LINHAS || n > TETO_DE_LINHAS) {
    return [
      { kind: "del", text: a },
      { kind: "add", text: b },
    ];
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    const row = dp[i]!;
    const next = dp[i + 1]!;
    for (let j = n - 1; j >= 0; j--) {
      row[j] = A[i] === B[j] ? next[j + 1]! + 1 : Math.max(next[j]!, row[j + 1]!);
    }
  }
  const out: LinhaDoDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (A[i] === B[j]) {
      out.push({ kind: "ctx", text: A[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: "del", text: A[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: B[j]! });
      j++;
    }
  }
  while (i < m) out.push({ kind: "del", text: A[i++]! });
  while (j < n) out.push({ kind: "add", text: B[j++]! });
  return out;
}

/** Quantas linhas entraram e saíram — o resumo que cabe num selo. */
export function contarMudancas(linhas: readonly LinhaDoDiff[]): { entraram: number; sairam: number } {
  let entraram = 0;
  let sairam = 0;
  for (const l of linhas) {
    if (l.kind === "add") entraram++;
    else if (l.kind === "del") sairam++;
  }
  return { entraram, sairam };
}
