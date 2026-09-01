/**
 * Flow Engine — plano + configs = grafo. TUDO determinístico, nada de modelo.
 *
 * ═══ Por que esta peça existe ═══
 *
 * O modelo é bom em decidir QUAIS blocos e o que cada um deve fazer. É ruim em
 * três coisas que este arquivo faz sem errar: posicionar no plano cartesiano
 * (já era assim — `auto-layout.ts`), manter ids únicos, e — a mais delicada —
 * casar o RÓTULO de uma saída ("Score alto") com o `branch_id` real que só
 * existe depois que o config do `logic.if` foi gerado.
 *
 * ═══ A reconciliação de ramo, e por que ela não é detalhe ═══
 *
 * O plano diz `{ de: "checa", para: "avisa", ramo: "Score alto" }`. O grafo
 * exige `branch_id`, e os ids das saídas de um `logic.if` são
 * `config.saidas[].id` — inventados pelo modelo na ETAPA 2, depois que o plano
 * já existia. Sem casar as duas pontas, a aresta aponta para um handle que não
 * existe: o grafo desenha bonito na tela, `analisarGrafo` não reclama (ele
 * valida nós, não destino de ramo), e o fluxo simplesmente não segue por ali no
 * primeiro lead. É o tipo de defeito que este motor foi feito para não ter.
 *
 * O casamento é por rótulo (igualdade sem acento/caixa), depois por posição, e
 * por fim `RAMO_PADRAO`. Nunca falha, nunca lança: o pior caso é a aresta ir
 * pelo "senão", que é um fluxo funcionando de um jeito que a pessoa corrige na
 * tela — e não um fluxo mudo.
 *
 * ═══ Aceitação parcial ═══
 *
 * Bloco sem config resolvida recebe `configExemploDoTipo`. Isso é o que impede
 * que uma chamada falha entre vinte apague o trabalho inteiro, que era o modo
 * de falha do caminho anterior.
 */
import { flowGraphSchema, type FlowGraph } from "../graph-schema";
import { configExemploDoTipo } from "../node-examples";
import { garantirNosRegistrados } from "../register-all";
import { buscarNo } from "../registry";
import { RAMO_PADRAO } from "../types";
import { autoLayout } from "./auto-layout";
import type { PlanoDeFluxo } from "./plan-schema";

export interface ConfigResolvida {
  config: Record<string, unknown>;
  /** "exemplo" = o modelo não entregou nada utilizável para este bloco. */
  origem: "ia" | "exemplo";
  causa?: string;
}

export interface Descarte {
  o_que: string;
  motivo: string;
}

export interface GrafoMontado {
  grafo: FlowGraph;
  /** `false` quando nem um bloco sobreviveu — a tela mostra o motivo, não um quadro vazio. */
  valido: boolean;
  descartes: Descarte[];
  /** Quantos blocos ficaram com valores padrão — a tela precisa dizer isso. */
  comExemplo: number;
}

/** Compara rótulos como uma pessoa compara: sem acento, sem caixa, sem espaço extra. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** As saídas declaradas no config de um bloco, quando ele tem saídas nomeadas. */
function saidasDoConfig(config: Record<string, unknown>): { id: string; label: string }[] {
  const saidas = config.saidas;
  if (!Array.isArray(saidas)) return [];
  return saidas
    .filter((s): s is { id: string; label?: string } => typeof s === "object" && s !== null)
    .filter((s) => typeof s.id === "string" && s.id.length > 0)
    .map((s) => ({ id: s.id, label: typeof s.label === "string" ? s.label : "" }));
}

/**
 * O `branch_id` real para uma ligação do plano.
 *
 * Ordem: rótulo igual → a n-ésima saída na ordem em que as ligações com ramo
 * aparecem → `else`. A segunda regra existe porque o modelo às vezes escreve o
 * rótulo da saída no plano e outro no config, e a ORDEM quase sempre bate — é
 * uma recuperação barata que salva o fluxo em vez de mandar tudo para o "senão".
 */
function resolverRamo(
  ramo: string | undefined,
  saidas: readonly { id: string; label: string }[],
  ordemDaLigacao: number,
): string {
  if (saidas.length === 0) return RAMO_PADRAO;
  if (ramo === undefined || ramo.trim() === "") return RAMO_PADRAO;

  const alvo = normalizar(ramo);
  const porRotulo = saidas.find((s) => normalizar(s.label) === alvo);
  if (porRotulo) return porRotulo.id;

  const porId = saidas.find((s) => normalizar(s.id) === alvo);
  if (porId) return porId.id;

  return saidas[ordemDaLigacao]?.id ?? RAMO_PADRAO;
}

/**
 * Monta o grafo. Nunca lança, e a saída SEMPRE passa em `flowGraphSchema` — a
 * tela e o "Salvar rascunho" recebem um grafo como qualquer outro, montado à
 * mão ou não.
 */
export function planoParaGrafo(
  plano: PlanoDeFluxo,
  configs: ReadonlyMap<string, ConfigResolvida>,
): GrafoMontado {
  garantirNosRegistrados();
  const descartes: Descarte[] = [];

  // ── 1. blocos: tipo conhecido, id único ──────────────────────────────────
  const renomeados = new Map<string, string>();
  const usados = new Set<string>();
  const blocos: { id: string; tipo: string; rotulo: string; original: string }[] = [];

  for (const [i, bruto] of plano.blocos.entries()) {
    if (buscarNo(bruto.tipo) === undefined) {
      descartes.push({
        o_que: `${bruto.id} (${bruto.tipo})`,
        motivo: "tipo de bloco que esta versão não conhece",
      });
      continue;
    }
    // Id repetido não é fatal: renomear e reapontar preserva o trabalho, e
    // deixar passar faria `analisarGrafo` acusar `id_duplicado` na cara da
    // pessoa por um erro que não foi dela.
    let id = bruto.id;
    if (usados.has(id)) {
      id = `${bruto.id}_${i + 1}`;
      while (usados.has(id)) id = `${id}_`;
      descartes.push({ o_que: bruto.id, motivo: `id repetido — renomeado para ${id}` });
    }
    usados.add(id);
    renomeados.set(bruto.id, id);
    blocos.push({ id, tipo: bruto.tipo, rotulo: bruto.rotulo, original: bruto.id });
  }

  // ── 2. config de cada bloco, com queda para o exemplo ────────────────────
  let comExemplo = 0;
  const configPorId = new Map<string, Record<string, unknown>>();
  for (const bloco of blocos) {
    const resolvida = configs.get(bloco.original) ?? configs.get(bloco.id);
    if (resolvida && resolvida.origem === "ia") {
      configPorId.set(bloco.id, resolvida.config);
      continue;
    }
    // `?? exemplo` não basta e o teste pegou: um `{ config: {}, origem:
    // "exemplo" }` tem config NÃO-nula e vazia, então passaria direto — e o
    // bloco chegaria ao editor sem campo nenhum, que é precisamente o que o
    // valor de queda existe para impedir. A queda é por CONTEÚDO, não por
    // ausência.
    const vazia = !resolvida || Object.keys(resolvida.config).length === 0;
    configPorId.set(
      bloco.id,
      vazia ? configExemploDoTipo(bloco.tipo) : resolvida.config,
    );
    comExemplo += 1;
  }

  // ── 3. arestas, com o ramo reconciliado ──────────────────────────────────
  const vivos = new Set(blocos.map((b) => b.id));
  const ordemPorOrigem = new Map<string, number>();
  const arestas: FlowGraph["edges"] = [];

  for (const [i, ligacao] of plano.ligacoes.entries()) {
    const de = renomeados.get(ligacao.de) ?? ligacao.de;
    const para = renomeados.get(ligacao.para) ?? ligacao.para;
    if (!vivos.has(de) || !vivos.has(para)) {
      descartes.push({
        o_que: `${ligacao.de} → ${ligacao.para}`,
        motivo: "ligação para um bloco que não existe",
      });
      continue;
    }
    const saidas = saidasDoConfig(configPorId.get(de) ?? {});
    const ordem = ordemPorOrigem.get(de) ?? 0;
    const branch_id = resolverRamo(ligacao.ramo, saidas, ordem);
    if (ligacao.ramo !== undefined && ligacao.ramo.trim() !== "") {
      ordemPorOrigem.set(de, ordem + 1);
    }
    arestas.push({ id: `e${i + 1}_${de}_${para}`.slice(0, 96), source: de, target: para, branch_id });
  }

  // ── 4. posição: BFS a partir do trigger, nunca pedida ao modelo ──────────
  const posicoes = autoLayout(
    blocos.map((b) => ({ id: b.id, type: b.tipo })),
    arestas.map((a) => ({ source: a.source, target: a.target })),
  );

  const grafo: FlowGraph = {
    nodes: blocos.map((b) => ({
      id: b.id,
      type: b.tipo,
      label: b.rotulo,
      position: posicoes[b.id] ?? { x: 0, y: 0 },
      config: configPorId.get(b.id) ?? {},
    })),
    edges: arestas,
  };

  // Recusa da própria saída é preferível a devolver algo que a tela não desenha:
  // se o plano veio vazio (ou tudo foi descartado), `nodes.min(1)` reprova aqui,
  // dentro da nossa fronteira, em vez de virar erro obscuro no editor.
  const conferido = flowGraphSchema.safeParse(grafo);
  if (!conferido.success) {
    return {
      grafo,
      valido: false,
      descartes: [
        ...descartes,
        { o_que: "grafo", motivo: conferido.error.issues[0]?.message ?? "grafo inválido" },
      ],
      comExemplo,
    };
  }

  return { grafo: conferido.data, valido: true, descartes, comExemplo };
}
