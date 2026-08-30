/**
 * Flow Engine — o que a publicação exige, e o rascunho não.
 *
 * A divisão é deliberada: `analisarGrafo` deixa salvar um grafo meio montado
 * (senão o operador perde trabalho ao trocar de tela no meio); ESTE arquivo é o
 * portão de "vai valer de verdade". Um fluxo publicado passa a ser disparado
 * por evento real sobre lead real, e um caminho sem saída aqui é uma automação
 * que some no meio sem ninguém notar.
 */

import { analisarGrafo, arestaDoRamo, type ErroDeGrafo, type FlowGraph } from "./graph-schema";

export interface ResultadoDaValidacao {
  ok: boolean;
  erros: ErroDeGrafo[];
  /** Não impedem publicar, mas a tela mostra. */
  avisos: ErroDeGrafo[];
}

export function validarParaPublicar(grafo: FlowGraph): ResultadoDaValidacao {
  const analisado = analisarGrafo(grafo);
  const erros: ErroDeGrafo[] = [...analisado.erros];
  const avisos: ErroDeGrafo[] = [];
  const { nos, arestas } = analisado;

  // Erro de forma já impede tudo o mais: as checagens abaixo leem `branches`,
  // que só existe em nó que passou pelo passe 2.
  if (erros.length > 0) return { ok: false, erros, avisos };

  // ── um gatilho, e só um ──────────────────────────────────────────────────
  const gatilhos = nos.filter((n) => n.category === "trigger");
  if (gatilhos.length === 0) {
    erros.push({
      ancora: "grafo",
      codigo: "sem_gatilho",
      mensagem: "O fluxo precisa de um bloco de início — o que faz ele começar.",
    });
  } else if (gatilhos.length > 1) {
    erros.push({
      ancora: gatilhos[1]!.id,
      codigo: "gatilho_repetido",
      mensagem: `O fluxo tem ${gatilhos.length} blocos de início. Só pode ter um.`,
    });
  }
  const entrada = gatilhos[0];

  // ── arestas apontam para coisas que existem ──────────────────────────────
  const porId = new Map(nos.map((n) => [n.id, n]));
  for (const aresta of arestas) {
    const origem = porId.get(aresta.source);
    if (origem === undefined) {
      erros.push({
        ancora: aresta.id,
        codigo: "origem_inexistente",
        mensagem: "Uma ligação sai de um bloco que não existe mais.",
      });
      continue;
    }
    if (!porId.has(aresta.target)) {
      erros.push({
        ancora: aresta.id,
        codigo: "destino_inexistente",
        mensagem: `A ligação que sai de "${origem.label}" aponta para um bloco que não existe mais.`,
      });
    }
    if (!origem.branches.some((b) => b.id === aresta.branch_id)) {
      // Acontece de verdade: o operador apaga uma regra do `logic.if` e a
      // aresta daquela saída fica órfã. Silenciar mandaria a execução pelo
      // caminho errado — a mesma armadilha que o follow-up documenta em
      // `branchIdForCondition`, onde a tela desenha certo e o roteamento erra.
      erros.push({
        ancora: aresta.id,
        codigo: "ramo_inexistente",
        mensagem: `"${origem.label}" não tem mais a saída à qual uma ligação está presa. Refaça a ligação.`,
      });
    }
    if (entrada !== undefined && aresta.target === entrada.id) {
      erros.push({
        ancora: aresta.id,
        codigo: "volta_ao_inicio",
        mensagem: "Nada pode voltar para o bloco de início.",
      });
    }
  }

  // ── toda saída de decisão tem para onde ir ───────────────────────────────
  // O pega-tudo pode ficar solto: ali "sem ligação" quer dizer "termina aqui",
  // e o motor completa com desfecho próprio. Uma saída de REGRA solta é outra
  // coisa — quem escreveu a regra esperava que ela levasse a algum lugar.
  for (const no of nos) {
    for (const ramo of no.branches) {
      if (ramo.kind === "fallback") continue;
      if (arestaDoRamo(arestas, no.id, ramo.id) === null) {
        erros.push({
          ancora: no.id,
          codigo: "ramo_sem_saida",
          mensagem: `A saída "${ramo.label}" de "${no.label}" não leva a lugar nenhum.`,
        });
      }
    }
  }

  if (entrada === undefined) return { ok: erros.length === 0, erros, avisos };

  // ── sem ciclo ────────────────────────────────────────────────────────────
  // Esta entrega tem UM cursor por execução: um ciclo rodaria para sempre
  // consumindo `steps_taken` até o teto e morrendo em `dead`. Loop de verdade
  // é um nó com contador (o `repeat` do follow-up), e ele não está aqui.
  const ciclo = acharCiclo(nos.map((n) => n.id), arestas);
  if (ciclo !== null) {
    erros.push({
      ancora: ciclo,
      codigo: "ciclo",
      mensagem: "As ligações formam um círculo — o fluxo voltaria ao mesmo bloco para sempre.",
    });
  }

  // ── tudo alcançável a partir do início ───────────────────────────────────
  const alcancados = alcancaveisDe(entrada.id, arestas);
  for (const no of nos) {
    if (no.id === entrada.id || alcancados.has(no.id)) continue;
    avisos.push({
      ancora: no.id,
      codigo: "inalcancavel",
      mensagem: `"${no.label}" não é alcançável a partir do início — ele nunca vai rodar.`,
    });
  }

  return { ok: erros.length === 0, erros, avisos };
}

/** Id de um nó dentro de um ciclo, ou `null`. Busca em profundidade com pilha. */
function acharCiclo(ids: readonly string[], arestas: readonly { source: string; target: string }[]): string | null {
  const saidas = new Map<string, string[]>();
  for (const a of arestas) {
    const lista = saidas.get(a.source);
    if (lista === undefined) saidas.set(a.source, [a.target]);
    else lista.push(a.target);
  }
  const BRANCO = 0, CINZA = 1, PRETO = 2;
  const cor = new Map<string, number>(ids.map((id) => [id, BRANCO]));

  // Iterativa e não recursiva: um grafo importado pode ter 200 nós em fila, e
  // recursão aqui é estouro de pilha dentro do worker.
  for (const raiz of ids) {
    if (cor.get(raiz) !== BRANCO) continue;
    const pilha: Array<{ id: string; restantes: string[] }> = [
      { id: raiz, restantes: [...(saidas.get(raiz) ?? [])] },
    ];
    cor.set(raiz, CINZA);
    while (pilha.length > 0) {
      const topo = pilha[pilha.length - 1]!;
      const proximo = topo.restantes.pop();
      if (proximo === undefined) {
        cor.set(topo.id, PRETO);
        pilha.pop();
        continue;
      }
      const c = cor.get(proximo);
      if (c === CINZA) return proximo;
      if (c === BRANCO) {
        cor.set(proximo, CINZA);
        pilha.push({ id: proximo, restantes: [...(saidas.get(proximo) ?? [])] });
      }
    }
  }
  return null;
}

function alcancaveisDe(inicio: string, arestas: readonly { source: string; target: string }[]): Set<string> {
  const saidas = new Map<string, string[]>();
  for (const a of arestas) {
    const lista = saidas.get(a.source);
    if (lista === undefined) saidas.set(a.source, [a.target]);
    else lista.push(a.target);
  }
  const vistos = new Set<string>();
  const fila = [inicio];
  while (fila.length > 0) {
    const atual = fila.pop()!;
    for (const destino of saidas.get(atual) ?? []) {
      if (vistos.has(destino)) continue;
      vistos.add(destino);
      fila.push(destino);
    }
  }
  return vistos;
}
