/**
 * Flow Engine — o grafo do quadro, descrito como PLANO.
 *
 * ═══ Por que o caminho de volta existe ═══
 *
 * A IA só sabia criar do zero: `onAtualizarCanvas` substitui `nos`/`arestas`
 * inteiros, e a etapa 1 nunca vê o que já está no quadro. "Troca a espera para
 * uma hora" ou "acrescenta um aviso depois da etiqueta" exigia descrever o fluxo
 * inteiro de novo e aceitar um fluxo inteiro novo — perdendo, junto, todo campo
 * que a pessoa tinha ajustado à mão.
 *
 * O plano é a linguagem que o modelo já fala (`plan-schema.ts`), então descrever
 * o grafo atual nela é o que torna o ajuste possível sem schema novo, sem
 * prompt novo de estrutura e sem uma segunda forma de representar fluxo — que
 * seria a segunda fonte de verdade que a doutrina proíbe.
 *
 * ═══ A `intencao` é reconstruída, e ela é a chave da economia ═══
 *
 * O plano exige `intencao` por bloco, e o grafo não guarda a frase que a gerou.
 * Aqui ela é REESCRITA a partir do rótulo e da config real do bloco. Não é
 * cosmética: é o que `ajustar` compara para decidir quais blocos mudaram. Bloco
 * cuja intenção reconstruída volta igual do modelo mantém a config que já
 * estava no quadro — e não paga uma chamada nem perde ajuste manual.
 */
import { analisarGrafo, type FlowGraph } from "../graph-schema";
import { garantirNosRegistrados } from "../register-all";
import type { PlanoDeFluxo } from "./plan-schema";

/** Quanto de config cabe numa intenção. O schema do plano corta em 200. */
const MAX_INTENCAO = 200;

/**
 * A config de um bloco, achatada em texto curto.
 *
 * Vale mais que uma descrição genérica: "esperar" não diz nada ao modelo, e
 * `duracao_ms=600000` diz que a pessoa escolheu dez minutos — o dado sem o qual
 * "muda a espera para uma hora" não tem o que mudar.
 */
function configComoTexto(config: unknown): string {
  if (config === null || typeof config !== "object") return "";
  const partes: string[] = [];
  for (const [chave, valor] of Object.entries(config as Record<string, unknown>)) {
    if (valor === null || valor === undefined) continue;
    const texto =
      typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean"
        ? String(valor)
        : JSON.stringify(valor);
    if (texto === "" || texto === "{}" || texto === "[]") continue;
    partes.push(`${chave}=${texto}`);
  }
  return partes.join(", ");
}

export function intencaoDoBloco(rotulo: string, config: unknown): string {
  const detalhe = configComoTexto(config);
  const frase = detalhe === "" ? rotulo : `${rotulo} (${detalhe})`;
  return frase.slice(0, MAX_INTENCAO);
}

export interface GrafoComoPlano {
  plano: PlanoDeFluxo;
  /** A config de cada bloco, por id — o que `ajustar` preserva sem repagar. */
  configPorId: Map<string, Record<string, unknown>>;
  /** A intenção reconstruída de cada bloco, para detectar o que o modelo mudou. */
  intencaoPorId: Map<string, string>;
}

/**
 * Descreve o grafo atual como plano. Nunca lança; um grafo que nem passa no
 * passe 2 volta descrito pela FORMA, que é o suficiente para o modelo entender
 * o que existe (e é melhor do que recusar o ajuste de um rascunho meio montado).
 */
export function grafoParaPlano(grafo: FlowGraph): GrafoComoPlano {
  garantirNosRegistrados();
  const analisado = analisarGrafo(grafo);
  // O passe 2 dá `branches`, que é o que traduz `branch_id` de volta ao RÓTULO
  // da saída — e rótulo é o que o plano usa no campo `ramo`. Sem ele, o modelo
  // receberia ids opacos ("s1") no lugar de "Score acima de 70".
  const rotuloDoRamo = new Map<string, string>();
  for (const no of analisado.nos) {
    for (const ramo of no.branches) rotuloDoRamo.set(`${no.id}:${ramo.id}`, ramo.label);
  }

  const configPorId = new Map<string, Record<string, unknown>>();
  const intencaoPorId = new Map<string, string>();

  const blocos = grafo.nodes.map((n) => {
    const config = (n.config ?? {}) as Record<string, unknown>;
    const intencao = intencaoDoBloco(n.label, config);
    configPorId.set(n.id, config);
    intencaoPorId.set(n.id, intencao);
    return { id: n.id, tipo: n.type, rotulo: n.label, intencao };
  });

  const ligacoes = grafo.edges.map((a) => {
    const rotulo = rotuloDoRamo.get(`${a.source}:${a.branch_id}`);
    // O pega-tudo não vira `ramo`: o plano trata "sem ramo" como a saída padrão,
    // e escrever o rótulo dele aqui faria a volta ao grafo tentar casá-lo como
    // se fosse uma saída de regra.
    const ehPadrao = a.branch_id === "else";
    return {
      de: a.source,
      para: a.target,
      ...(ehPadrao || rotulo === undefined ? {} : { ramo: rotulo.slice(0, 60) }),
    };
  });

  return { plano: { blocos, ligacoes }, configPorId, intencaoPorId };
}
