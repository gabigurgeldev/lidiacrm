/**
 * A cor que uma coluna MOSTRA quando ninguém escolheu uma.
 *
 * Coluna sem cor desenhava a faixa do topo em `--color-border` — cinza sobre
 * fundo quase cinza, invisível —, e a lista de Kanbans tinha a SUA paleta de
 * reserva, indexada pela posição na lista filtrada. A mesma coluna saía de uma
 * cor no quadro e de outra no cartão da lista. Agora as duas telas perguntam
 * aqui, pela posição da coluna no Kanban.
 *
 * Nada é gravado: a cor escolhida pelo usuário (`crm_stages.color`) continua
 * sendo a única que o banco conhece, e "Sem cor" no menu volta a esta.
 */
export const CORES_DE_RESERVA = [
  "#2563eb",
  "#0891b2",
  "#7c3aed",
  "#d97706",
  "#db2777",
  "#4f46e5",
] as const;

export function corDaColuna(cor: string | null | undefined, posicao: number): string {
  if (cor) return cor;
  const i = ((posicao % CORES_DE_RESERVA.length) + CORES_DE_RESERVA.length) % CORES_DE_RESERVA.length;
  return CORES_DE_RESERVA[i] ?? CORES_DE_RESERVA[0];
}
