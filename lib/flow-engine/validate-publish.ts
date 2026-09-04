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

  // ── toda saída de REGRA tem para onde ir ─────────────────────────────────
  // O pega-tudo pode ficar solto: ali "sem ligação" quer dizer "termina aqui",
  // e o motor completa com desfecho próprio. Uma saída de REGRA solta é outra
  // coisa — quem escreveu a regra esperava que ela levasse a algum lugar.
  //
  // Saída de EXCEÇÃO também pode ficar solta, e este `continue` é um conserto,
  // não uma flexibilização: antes dele, "Sem telefone do cliente" e "Não saiu
  // agora" — que vêm de fábrica em TODO bloco de mensagem — eram exigidas como
  // se fossem regras escritas. Um fluxo com cinco desses blocos precisava de
  // dez ligações para casos de erro que ninguém quis tratar, e sem elas não
  // publicava. O motor sempre soube o que fazer com um ramo solto: encerra a
  // frente com `sem_saida:<ramo>` (ver `engine.ts`, onde o comentário já dizia
  // que esta validação "só exige saída em ramo de REGRA" — e ela não fazia).
  for (const no of nos) {
    for (const ramo of no.branches) {
      if (ramo.kind === "fallback" || ramo.kind === "excecao") continue;
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

  // ── ciclo SEM contador ───────────────────────────────────────────────────
  //
  // A regra antiga era "nenhum ciclo", e o motivo estava certo: um ciclo sem fim
  // consome `steps_taken` até a execução morrer em `dead`. O que mudou é que
  // agora existe um bloco com contador — `logic.loop` tem `max` obrigatório, e
  // um ciclo que passa por ele tem fim CONHECIDO antes de começar.
  //
  // Por isso a busca roda sobre o grafo COM os nós de laço removidos: tirar
  // deles as arestas quebra exatamente os ciclos que têm contador, e o que
  // sobrar é ciclo de verdade — aquele que roda para sempre.
  const nosDeLaco = new Set(nos.filter((n) => n.type === "logic.loop").map((n) => n.id));
  const ciclo = acharCiclo(
    nos.filter((n) => !nosDeLaco.has(n.id)).map((n) => n.id),
    arestas.filter((a) => !nosDeLaco.has(a.source) && !nosDeLaco.has(a.target)),
  );
  if (ciclo !== null) {
    erros.push({
      ancora: ciclo,
      codigo: "ciclo",
      mensagem:
        "As ligações formam um círculo sem fim — o fluxo voltaria ao mesmo bloco para sempre. " +
        "Para repetir com fim, use o bloco \"Repetir para cada\".",
    });
  }

  // ── o reencontro de cada bifurcação existe, e é um reencontro ────────────
  //
  // `encontro` é declarado pelo fork, não descoberto pelo motor — inferir o
  // merge por alcançabilidade acerta no grafo simples e erra em silêncio quando
  // há dois forks aninhados. O preço de declarar é este: alguém tem de conferir
  // que o alvo existe. Se ninguém confere, o erro aparece só em runtime, como um
  // fluxo que bifurca e nunca mais se junta — e o motor não tem como distinguir
  // isso de um fluxo que termina em ramos separados de propósito.
  for (const no of nos) {
    if (no.type !== "logic.fork") continue;
    const alvo = (no.config as { encontro?: unknown }).encontro;
    const destino = typeof alvo === "string" ? nos.find((n) => n.id === alvo) : undefined;
    if (destino === undefined) {
      erros.push({
        ancora: no.id,
        codigo: "encontro_inexistente",
        mensagem: `"${no.label}" bifurca o fluxo mas o bloco de reencontro dele não existe.`,
      });
      continue;
    }
    if (destino.type !== "logic.merge") {
      erros.push({
        ancora: no.id,
        codigo: "encontro_nao_e_reencontro",
        mensagem: `O reencontro de "${no.label}" aponta para "${destino.label}", que não é um bloco de reencontro.`,
      });
    }
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
