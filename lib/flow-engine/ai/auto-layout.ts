/**
 * Flow Engine — posiciona um grafo que não tem posição.
 *
 * A IA nunca é perguntada por `position` (ver `generation-schema.ts`) — layout
 * espacial é a única coisa que um modelo de texto faz mal de graça, e o
 * resultado visual de coordenadas "chutadas" pelo modelo seria sofrível
 * (nós sobrepostos, sem relação com a ordem lógica). Esta função resolve isso
 * de verdade: BFS a partir do nó `trigger` (sempre existe — é o único bloco
 * obrigatório de todo fluxo), profundidade vira coluna, ordem dentro da
 * profundidade vira linha.
 *
 * Pura, determinística, sem I/O — mesma entrada sempre produz a mesma saída,
 * o que faz o teste ser aritmética e não snapshot visual.
 *
 * As constantes de espaçamento SÃO as mesmas que `FlowCanvas.tsx` usa ao
 * acrescentar um nó manualmente (`x: 80 + ... * 260`, `y: 80 + ... * 200`) —
 * um bloco criado à mão e um bloco criado pela IA precisam ficar visualmente
 * no mesmo grid, senão a mistura dos dois no mesmo quadro parece desenhada
 * por duas mãos diferentes.
 */

export interface NoParaLayout {
  id: string;
}
export interface ArestaParaLayout {
  source: string;
  target: string;
}

const COLUNA_PX = 260;
const LINHA_PX = 160;
const MARGEM_PX = 80;

/**
 * O nó de trigger é a raiz do BFS. Como o schema de geração não pede
 * `category` de volta (só o `type`), quem chama informa o `type` do trigger
 * pelo prefixo — hoje só existe `trigger.lead_created`, e um trigger novo
 * seguiria o mesmo namespace (`trigger.*`), a mesma convenção que
 * `FlowNodeDefinition.type` já documenta ("Namespace por categoria").
 */
function ehTrigger(tipo: string | undefined): boolean {
  return tipo?.startsWith("trigger.") ?? false;
}

export function autoLayout(
  nos: readonly (NoParaLayout & { type?: string })[],
  arestas: readonly ArestaParaLayout[],
): Record<string, { x: number; y: number }> {
  const posicoes: Record<string, { x: number; y: number }> = {};
  if (nos.length === 0) return posicoes;

  const porOrigem = new Map<string, string[]>();
  for (const a of arestas) {
    porOrigem.set(a.source, [...(porOrigem.get(a.source) ?? []), a.target]);
  }

  const raiz = nos.find((n) => ehTrigger(n.type)) ?? nos[0]!;
  const visitados = new Set<string>([raiz.id]);
  const idsValidos = new Set(nos.map((n) => n.id));

  // BFS em camadas: cada nível da fila é uma "coluna" inteira.
  let nivelAtual = [raiz.id];
  const porColuna: string[][] = [];
  while (nivelAtual.length > 0) {
    porColuna.push(nivelAtual);
    const proximo: string[] = [];
    for (const id of nivelAtual) {
      for (const vizinho of porOrigem.get(id) ?? []) {
        if (!idsValidos.has(vizinho) || visitados.has(vizinho)) continue;
        visitados.add(vizinho);
        proximo.push(vizinho);
      }
    }
    nivelAtual = proximo;
  }

  porColuna.forEach((idsDaColuna, c) => {
    idsDaColuna.forEach((id, linha) => {
      posicoes[id] = { x: MARGEM_PX + c * COLUNA_PX, y: MARGEM_PX + linha * LINHA_PX };
    });
  });

  // Nó inalcançável a partir do trigger (arestas ainda incompletas em pleno
  // streaming, ou um bloco solto de propósito): entra numa coluna EXTRA à
  // direita de tudo que já foi posicionado, nunca sobreposto.
  const inalcancaveis = nos.filter((n) => !visitados.has(n.id));
  const colunaExtra = porColuna.length;
  inalcancaveis.forEach((n, linha) => {
    posicoes[n.id] = { x: MARGEM_PX + colunaExtra * COLUNA_PX, y: MARGEM_PX + linha * LINHA_PX };
  });

  return posicoes;
}
