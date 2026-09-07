/**
 * Flow Engine — o laço que faz o fluxo gerado PUBLICAR.
 *
 * ═══ O buraco que este arquivo fecha ═══
 *
 * A régua que decide se um fluxo publica é `validarParaPublicar`. Ela não
 * rodava em ponto nenhum do caminho da IA: `plan-to-graph.ts` confere a saída
 * contra `flowGraphSchema`, que valida FORMA — ids, tipos conhecidos, config
 * que o `configSchema` aceita — e não diz nada sobre bifurcação sem reencontro,
 * ciclo sem contador ou saída de regra sem ligação.
 *
 * O resultado era sempre o mesmo: a IA entregava, a tela desenhava um fluxo
 * bonito, e o erro só aparecia quando a pessoa clicava em Publicar — em
 * vocabulário de motor, sobre um grafo que ela não escreveu e não sabe
 * consertar.
 *
 * ═══ Três degraus, do barato ao caro ═══
 *
 *   1. Já publica? Devolve. **Zero chamadas** — e é o caso comum.
 *   2. `repararGrafo`: os consertos que têm resposta única, sem modelo nenhum.
 *   3. UMA chamada de correção, com os erros restantes escritos em português.
 *
 * O degrau 3 é o que faz um modelo barato render como um caro: o que faltava ao
 * modelo não era capacidade, era saber o que ele tinha quebrado. E ele nunca
 * PIORA o resultado — a correção só entra se o grafo corrigido tiver menos
 * erros que o anterior.
 *
 * O que sobrar vira `pendencias`, que a tela mostra ancorada no bloco, em vez
 * de a pessoa descobrir no botão Publicar.
 */
import { planoParaGrafo, type ConfigResolvida } from "./plan-to-graph";
import { montarSchemaDePlano, TOKENS_DO_PLANO, type PlanoDeFluxo } from "./plan-schema";
import { planoComoTexto, promptDeCorrecao } from "./prompt";
import { repararGrafo, type Conserto } from "./reparar";
import type { PortaDeModelo } from "./modelo-com-fallback";
import type { ErroDeGrafo, FlowGraph } from "../graph-schema";
import { validarParaPublicar } from "../validate-publish";

export interface ResultadoPublicavel {
  grafo: FlowGraph;
  /** O que o reparo determinístico fez. Vazio quando não fez nada. */
  consertos: Conserto[];
  /** `true` quando a chamada de correção entrou E melhorou. */
  corrigidoPeloModelo: boolean;
  /** O que ainda impede publicar. Vazio quando o fluxo está pronto. */
  pendencias: ErroDeGrafo[];
  /** Quantas chamadas ao provedor este laço custou (0 ou 1). */
  chamadas: number;
}

function erros(grafo: FlowGraph): ErroDeGrafo[] {
  return validarParaPublicar(grafo).erros;
}

export async function tornarPublicavel(args: {
  porta: PortaDeModelo;
  plano: PlanoDeFluxo;
  /** As configs já geradas na etapa 2 — reusadas por id, para não pagar de novo. */
  configs: ReadonlyMap<string, ConfigResolvida>;
  grafo: FlowGraph;
  sinal?: AbortSignal;
}): Promise<ResultadoPublicavel> {
  // ── degrau 1: já publica ────────────────────────────────────────────────
  const errosIniciais = erros(args.grafo);
  if (errosIniciais.length === 0) {
    return {
      grafo: args.grafo,
      consertos: [],
      corrigidoPeloModelo: false,
      pendencias: [],
      chamadas: 0,
    };
  }

  // ── degrau 2: o conserto que não precisa de modelo ──────────────────────
  const reparado = repararGrafo(args.grafo);
  const errosAposReparo = erros(reparado.grafo);
  if (errosAposReparo.length === 0) {
    return {
      grafo: reparado.grafo,
      consertos: reparado.consertos,
      corrigidoPeloModelo: false,
      pendencias: [],
      chamadas: 0,
    };
  }

  // ── degrau 3: uma chamada, com o erro na mão ────────────────────────────
  if (args.sinal?.aborted === true) {
    return {
      grafo: reparado.grafo,
      consertos: reparado.consertos,
      corrigidoPeloModelo: false,
      pendencias: errosAposReparo,
      chamadas: 0,
    };
  }

  const resposta = await args.porta.objeto({
    schema: montarSchemaDePlano(),
    system: promptDeCorrecao(errosAposReparo.map((e) => e.mensagem)),
    prompt: planoComoTexto(args.plano),
    maxOutputTokens: TOKENS_DO_PLANO,
    rotulo: "correcao",
    sinal: args.sinal,
  });

  if (!resposta.ok || resposta.objeto === undefined) {
    return {
      grafo: reparado.grafo,
      consertos: reparado.consertos,
      corrigidoPeloModelo: false,
      pendencias: errosAposReparo,
      chamadas: 1,
    };
  }

  // As configs são reusadas por id: um bloco que a correção não mexeu mantém o
  // que a etapa 2 já pagou para gerar. Bloco novo cai no exemplo do tipo, que é
  // a mesma queda que a montagem normal pratica.
  const remontado = planoParaGrafo(resposta.objeto, args.configs);
  if (!remontado.valido) {
    return {
      grafo: reparado.grafo,
      consertos: reparado.consertos,
      corrigidoPeloModelo: false,
      pendencias: errosAposReparo,
      chamadas: 1,
    };
  }

  const reparadoDeNovo = repararGrafo(remontado.grafo);
  const errosFinais = erros(reparadoDeNovo.grafo);

  // ⚠️ A CORREÇÃO SÓ ENTRA SE MELHORAR. Sem esta comparação, um modelo que
  // "corrige" trocando um erro por dois deixaria a pessoa com um fluxo pior do
  // que o que ela teria sem o laço — e sem nenhuma forma de perceber.
  if (errosFinais.length >= errosAposReparo.length) {
    return {
      grafo: reparado.grafo,
      consertos: reparado.consertos,
      corrigidoPeloModelo: false,
      pendencias: errosAposReparo,
      chamadas: 1,
    };
  }

  return {
    grafo: reparadoDeNovo.grafo,
    consertos: [...reparado.consertos, ...reparadoDeNovo.consertos],
    corrigidoPeloModelo: true,
    pendencias: errosFinais,
    chamadas: 1,
  };
}
