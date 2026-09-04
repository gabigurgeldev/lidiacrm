import { MarkerType, type Edge, type Node } from "@xyflow/react";

import type { FlowBranch } from "@/lib/flow-engine/types";

import type { DadosDoNo } from "./NoDoFluxo";

/**
 * As regras do quadro que são PURAS — desenho de linha e cópia de bloco.
 *
 * Moram fora de `FlowCanvas.tsx` para poderem ser exercitadas sem montar o
 * React Flow inteiro: as duas têm invariante que se quebra em silêncio (uma
 * linha rotulada com o nome antigo do ramo, uma cópia que compartilha o array
 * de regras com o original), e invariante que se quebra em silêncio é
 * exatamente a que precisa de teste.
 */

/**
 * A LINHA DIZ DE QUAL SAÍDA ELA SAIU — e a de exceção não se parece com as outras.
 *
 * Sem isto, um `logic.if` com quatro regras produzia quatro linhas idênticas
 * saindo do mesmo cartão: para saber qual era a da regra "Score acima de 70",
 * clicava-se uma por uma até o painel dizer. Com dez blocos no quadro, é o
 * momento em que o desenho para de ajudar e vira ruído.
 *
 * A decoração é DERIVADA a cada render, e não gravada na aresta: o rótulo do
 * ramo muda quando a pessoa renomeia a regra no painel, e uma cópia gravada na
 * aresta ficaria dizendo o nome antigo — o mesmo tipo de divergência que o
 * cabeçalho de `FlowCanvas.tsx` já proíbe para as saídas.
 *
 * Nada disto vai para `paraGrafo`: `label`, `style` e `markerEnd` são desenho.
 * O contrato salvo continua sendo `{ id, source, target, branch_id }`.
 */
export function decorarArestas(
  nos: Node[],
  arestas: Edge[],
  traduzir: (s: string) => string,
): Edge[] {
  const ramosPorNo = new Map<string, FlowBranch[]>(
    nos.map((n) => [n.id, (n.data as DadosDoNo).branches ?? []]),
  );
  return arestas.map((a) => {
    const ramos = ramosPorNo.get(a.source) ?? [];
    const ramo = ramos.find((r) => r.id === (a.sourceHandle ?? "else"));
    const ehExcecao = ramo?.kind === "excecao";
    return {
      ...a,
      // Bloco de saída única — "Segue", "Começa aqui" — não ganha rótulo: ele
      // repetiria no quadro o que o cartão já diz, em toda linha.
      label: ramo !== undefined && ramos.length > 1 ? traduzir(ramo.label) : undefined,
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      // Tracejada e apagada: caminho de erro se lê como desvio, não como o
      // percurso normal — a mesma distinção que o cartão faz na lista de saídas.
      style: ehExcecao ? { strokeDasharray: "6 4", opacity: 0.55 } : undefined,
    };
  });
}

/**
 * DUPLICAR: o mesmo bloco, com a MESMA config, ao lado. `null` quando não pode.
 *
 * Montar cinco mensagens parecidas custava preencher o formulário cinco vezes —
 * e o segundo bloco não erra pelo que se digita, erra pelo que se esquece de
 * copiar (o número de saída, o modo do menu, o intervalo entre disparos).
 *
 * O que NÃO é copiado, de propósito:
 *
 *   - **as ligações.** Uma cópia herdando as arestas do original faria duas
 *     linhas saírem da mesma saída do bloco anterior, e o motor escolheria a
 *     primeira que achasse — comportamento por acaso de ordem, que é o mesmo
 *     que `aoLigar` recusa ao ligar à mão.
 *   - **o gatilho.** Um fluxo tem um gatilho, e só um (`validate-publish.ts`
 *     cobra). Duplicá-lo criaria um fluxo que não publica, com a causa longe do
 *     gesto que a produziu — daí o `null` em vez de uma cópia inútil.
 *
 * `structuredClone` e não espalhamento: a config tem listas de objetos
 * (`saidas`, `opcoes`, `ramos`), e uma cópia rasa deixaria as duas apontando
 * para o MESMO array — editar a regra da cópia mudaria a do original, e o
 * sintoma apareceria no bloco que ninguém abriu.
 */
export function duplicarNo(nos: Node[], id: string, novoId: string): Node | null {
  const original = nos.find((n) => n.id === id);
  if (original === undefined) return null;
  const d = original.data as DadosDoNo;
  if (d.categoria === "trigger") return null;
  return {
    ...original,
    id: novoId,
    selected: false,
    position: { x: original.position.x + 40, y: original.position.y + 60 },
    data: { ...d, config: structuredClone(d.config ?? {}) },
  };
}
