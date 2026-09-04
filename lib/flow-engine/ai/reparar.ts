/**
 * Flow Engine — o conserto que não precisa de modelo.
 *
 * ═══ Por que existe ═══
 *
 * A régua que decide se um fluxo publica é `validarParaPublicar`, e ela nunca
 * rodava no caminho da IA: `plan-to-graph.ts` conferia a saída contra
 * `flowGraphSchema`, que só valida FORMA. O modelo entregava, a tela desenhava,
 * e o erro aparecia quando a pessoa clicava em Publicar — em vocabulário de
 * motor ("o reencontro de X não existe"), sobre um grafo que ela não escreveu.
 *
 * Uma parte desses erros tem UM conserto certo, e não é preciso pagar uma
 * chamada de IA para descobri-lo:
 *
 *   - bifurcação apontando para um reencontro que não existe, num fluxo que tem
 *     exatamente um reencontro alcançável: só pode ser aquele;
 *   - ligação voltando ao gatilho: o motor nunca a percorreria de qualquer
 *     forma, e ela reprova a publicação;
 *   - saída de REGRA sem ligação: o caminho termina ali, e "termina ali" tem um
 *     bloco próprio.
 *
 * O que este arquivo NÃO faz, de propósito: inventar config, apagar bloco,
 * escolher qual aresta de um ciclo cortar, ou decidir qual gatilho fica quando
 * há dois. Nesses o conserto depende de intenção, e intenção é do modelo (uma
 * chamada de correção) ou da pessoa. Reparo automático que adivinha intenção
 * produz fluxo que publica e faz a coisa errada — pior que o erro.
 *
 * Puro, determinístico e sem I/O: dá para provar num teste sem provedor nenhum,
 * que é o que faz dele a parte barata do laço de correção.
 */
import { analisarGrafo, arestaDoRamo, type FlowGraph } from "../graph-schema";
import { configExemploDoTipo } from "../node-examples";
import { garantirNosRegistrados } from "../register-all";

export interface Conserto {
  /** O nó ou a aresta consertada — a tela ancora por este id. */
  ancora: string;
  /** Em português, o que foi feito. Vai ao log e à tela. */
  oQueFoiFeito: string;
}

export interface ResultadoDoReparo {
  grafo: FlowGraph;
  consertos: Conserto[];
}

const TIPO_FIM = "logic.end";
const TIPO_BIFURCA = "logic.fork";
const TIPO_REENCONTRO = "logic.merge";

/** Onde pôr um bloco criado: à direita do que o originou, sem sobrepor. */
const DESLOCAMENTO_X = 260;

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

function idLivre(base: string, usados: ReadonlySet<string>): string {
  if (!usados.has(base)) return base;
  let i = 2;
  while (usados.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

/**
 * Conserta o que tem conserto único. Nunca lança; devolve o grafo original
 * quando não há nada a fazer (ou quando ele nem passa no passe 2).
 */
export function repararGrafo(grafo: FlowGraph): ResultadoDoReparo {
  garantirNosRegistrados();
  const analisado = analisarGrafo(grafo);
  // Erro de FORMA não é reparável aqui: sem o passe 2 não há `branches`, e
  // mexer no grafo às cegas é como o reparo vira estrago.
  if (analisado.erros.length > 0) return { grafo, consertos: [] };

  const consertos: Conserto[] = [];
  const nodes = grafo.nodes.map((n) => ({ ...n }));
  let edges = grafo.edges.map((e) => ({ ...e }));
  const porId = new Map(nodes.map((n) => [n.id, n]));
  const usados = new Set(nodes.map((n) => n.id));

  // ── 1. a bifurcação aponta para um reencontro que existe ─────────────────
  const reencontros = nodes.filter((n) => n.type === TIPO_REENCONTRO);
  for (const no of nodes) {
    if (no.type !== TIPO_BIFURCA) continue;
    const config = (no.config ?? {}) as { encontro?: unknown };
    const alvo = typeof config.encontro === "string" ? porId.get(config.encontro) : undefined;
    if (alvo?.type === TIPO_REENCONTRO) continue;

    // Alcançáveis primeiro: num grafo com duas bifurcações aninhadas, o
    // reencontro certo é o que esta bifurcação alcança, não "o único do grafo".
    const alcancados = alcancaveisDe(no.id, edges);
    const candidatos = reencontros.filter((m) => alcancados.has(m.id));
    const escolhido = candidatos.length === 1 ? candidatos[0] : reencontros.length === 1 ? reencontros[0] : undefined;
    if (escolhido === undefined) continue; // ambíguo: fica para o modelo

    no.config = { ...(no.config as Record<string, unknown>), encontro: escolhido.id };
    consertos.push({
      ancora: no.id,
      oQueFoiFeito: `"${no.label}" passou a reencontrar em "${escolhido.label}".`,
    });
  }

  // ── 2. nada volta ao gatilho ─────────────────────────────────────────────
  const gatilho = analisado.nos.find((n) => n.category === "trigger");
  if (gatilho !== undefined) {
    const antes = edges.length;
    const removidas = edges.filter((a) => a.target === gatilho.id);
    edges = edges.filter((a) => a.target !== gatilho.id);
    if (edges.length !== antes) {
      for (const a of removidas) {
        const origem = porId.get(a.source);
        consertos.push({
          ancora: a.id,
          oQueFoiFeito: `A ligação de "${origem?.label ?? a.source}" de volta ao início foi removida — o motor nunca a percorreria.`,
        });
      }
    }
  }

  // ── 3. toda saída de REGRA leva a algum lugar ────────────────────────────
  //
  // O destino é um bloco de fim, e não o próximo bloco por proximidade: "esta
  // saída não foi ligada" quer dizer "este caminho acaba aqui", e acabar tem um
  // bloco próprio. Adivinhar o destino seria inventar comportamento.
  let fim = nodes.find((n) => n.type === TIPO_FIM);
  const soltos: { no: (typeof analisado.nos)[number]; ramo: { id: string; label: string } }[] = [];
  for (const no of analisado.nos) {
    for (const ramo of no.branches) {
      if (ramo.kind !== "match") continue;
      if (arestaDoRamo(edges, no.id, ramo.id) !== null) continue;
      soltos.push({ no, ramo });
    }
  }

  if (soltos.length > 0) {
    if (fim === undefined) {
      const origem = porId.get(soltos[0]!.no.id);
      const id = idLivre("fim", usados);
      usados.add(id);
      fim = {
        id,
        type: TIPO_FIM,
        label: "Fim",
        position: {
          x: (origem?.position.x ?? 0) + DESLOCAMENTO_X,
          y: origem?.position.y ?? 0,
        },
        config: configExemploDoTipo(TIPO_FIM),
      };
      nodes.push(fim);
      porId.set(fim.id, fim);
      consertos.push({
        ancora: fim.id,
        oQueFoiFeito: 'Um bloco "Fim" foi criado para as saídas que não levavam a lugar nenhum.',
      });
    }
    for (const [i, solto] of soltos.entries()) {
      edges.push({
        id: `reparo${i + 1}_${solto.no.id}_${fim.id}`.slice(0, 96),
        source: solto.no.id,
        target: fim.id,
        branch_id: solto.ramo.id,
      });
      consertos.push({
        ancora: solto.no.id,
        oQueFoiFeito: `A saída "${solto.ramo.label}" de "${solto.no.label}" passou a terminar o fluxo.`,
      });
    }
  }

  if (consertos.length === 0) return { grafo, consertos: [] };
  return { grafo: { nodes, edges }, consertos };
}
