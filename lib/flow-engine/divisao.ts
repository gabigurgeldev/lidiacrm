/**
 * Flow Engine — como o bloco "Dividir os caminhos" escolhe por qual saída seguir.
 *
 * Três funções puras, sem banco e sem relógio, espelhando `lib/routing/decide.ts`.
 * Elas existem separadas do nó pelo mesmo motivo daquelas: distribuição é a
 * regra que mais precisa ser medida em teste, e medir dentro de um `execute`
 * que fala com portas obriga a montar meio motor para responder "e se vierem
 * mil?".
 *
 * ## As três respondem perguntas diferentes
 *
 * - `escolherAleatorio` — "que ninguém consiga prever". O acaso CONCENTRA: três
 *   execuções seguidas pelo mesmo caminho é resultado normal, não defeito. Quem
 *   quer divisão pareja não usa este modo.
 * - `escolherPorFila` — "a ordem é esta". Gira 1,2,3,1,2,3 e não olha placar. É
 *   a fila indiana, com o cursor guardado FORA da execução (ver `PortaDeDivisao`).
 * - `escolherPorPlacar` — "iguala no fim do mês". Olha quantas vezes cada saída
 *   já foi usada e manda para a que está atrás. É o único modo que se corrige:
 *   uma saída acrescentada depois entra com placar zero e ABSORVE as próximas
 *   até empatar com as outras. Isso é a feature, não um efeito colateral — quem
 *   pediu "igualitária" pediu exatamente que o desequilíbrio seja compensado.
 */

/** Ordem estável: um sorteio sobre ordem instável é irreproduzível mesmo com `rng` fixo. */
function ordenados(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Sorteio uniforme. `rng` é injetável para o teste medir a distribuição sem
 * depender de sorte — mesmo contrato de `selectRandom` em `lib/routing/decide.ts`.
 */
export function escolherAleatorio(
  ids: readonly string[],
  rng: () => number = Math.random,
): string | null {
  if (ids.length === 0) return null;
  const lista = ordenados(ids);
  const i = Math.min(lista.length - 1, Math.max(0, Math.floor(rng() * lista.length)));
  return lista[i] ?? null;
}

/**
 * A vez, dada a posição do cursor.
 *
 * A ordem aqui é a que o operador DESENHOU (a ordem dos caminhos na config), e
 * não a alfabética: no quadro os handles saem de cima para baixo nessa ordem, e
 * uma fila que girasse por outro critério não bateria com o que a pessoa vê.
 */
export function escolherPorFila(ids: readonly string[], cursor: number): string | null {
  if (ids.length === 0) return null;
  // `%` de negativo em JS devolve negativo: um cursor corrompido (ou vindo de
  // uma RPC que falhou) tiraria um `undefined` do array e o bloco morreria por
  // um dado que não é dele. O piso resolve sem esconder nada.
  const i = ((cursor % ids.length) + ids.length) % ids.length;
  return ids[i] ?? null;
}

/**
 * A saída que está ATRÁS no placar. Empate resolve pelo id — desempate
 * determinístico, senão duas execuções idênticas dariam caminhos diferentes e
 * nenhum teste conseguiria vigiar o modo.
 *
 * Caminho ausente do placar conta 0. É o que faz uma saída nova receber tudo
 * até alcançar as antigas.
 */
export function escolherPorPlacar(
  ids: readonly string[],
  placar: Readonly<Record<string, number>>,
): string | null {
  if (ids.length === 0) return null;
  let escolhido: string | null = null;
  let menor = Number.POSITIVE_INFINITY;
  for (const id of ordenados(ids)) {
    const contagem = placar[id] ?? 0;
    if (contagem < menor) {
      menor = contagem;
      escolhido = id;
    }
  }
  return escolhido;
}
