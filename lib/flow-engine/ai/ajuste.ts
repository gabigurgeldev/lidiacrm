/**
 * Flow Engine — mexer num fluxo que JÁ EXISTE, sem refazê-lo.
 *
 * ═══ O que não dava para fazer ═══
 *
 * A IA só criava do zero. "Troca a espera para uma hora" obrigava a descrever o
 * fluxo inteiro de novo, aceitar um fluxo inteiro novo, e perder junto todo
 * campo que a pessoa tinha ajustado à mão desde a última geração.
 *
 * ═══ A regra que faz o ajuste ser barato E não destrutivo ═══
 *
 * O grafo atual é descrito como plano (`grafo-para-plano.ts`), com a `intencao`
 * de cada bloco RECONSTRUÍDA do rótulo e da config real. O modelo devolve o
 * plano ajustado. Um bloco cujo id existia antes E cuja intenção voltou igual
 * NÃO MUDOU: a config dele é a que já estava no quadro.
 *
 * Isso vale duas coisas ao mesmo tempo, e a segunda importa mais:
 *
 *   1. não paga a etapa 2 de novo para o fluxo inteiro — só os blocos tocados;
 *   2. **não sobrescreve o que a pessoa ajustou à mão.** Regerar a config de um
 *      bloco intocado devolveria o que o modelo acha que ela deve ser, apagando
 *      o texto que ela escreveu no editor. Um "ajuste" que apaga trabalho é
 *      pior do que não ter ajuste.
 */
import type { PlanoDeFluxo } from "./plan-schema";
import type { ConfigResolvida } from "./plan-to-graph";

export interface DivisaoDoAjuste {
  /** Os blocos que precisam da etapa 2 — novos ou com intenção diferente. */
  aGerar: PlanoDeFluxo;
  /** As configs preservadas do quadro, prontas para `planoParaGrafo`. */
  preservadas: Map<string, ConfigResolvida>;
  /** Ids preservados — vai ao log, e é o número que prova a economia. */
  idsPreservados: string[];
}

/**
 * Separa o plano ajustado em "o que mudou" e "o que fica como está".
 *
 * As ligações vão INTEIRAS no plano de geração: elas não custam chamada (a
 * etapa 2 só olha blocos), e `promptDoBloco` usa a vizinhança para escrever os
 * rótulos de saída certos. Cortá-las aqui tiraria contexto de graça.
 */
export function dividirOAjuste(
  planoAjustado: PlanoDeFluxo,
  configPorId: ReadonlyMap<string, Record<string, unknown>>,
  intencaoPorId: ReadonlyMap<string, string>,
): DivisaoDoAjuste {
  const preservadas = new Map<string, ConfigResolvida>();
  const idsPreservados: string[] = [];
  const aGerar: PlanoDeFluxo["blocos"] = [];

  for (const bloco of planoAjustado.blocos) {
    const configAntiga = configPorId.get(bloco.id);
    const intencaoAntiga = intencaoPorId.get(bloco.id);
    const intacto =
      configAntiga !== undefined &&
      intencaoAntiga !== undefined &&
      intencaoAntiga.trim() === bloco.intencao.trim();

    if (intacto) {
      // `origem: "ia"` porque `planoParaGrafo` usa esse rótulo para decidir se
      // aceita a config como está, e esta config é melhor que qualquer coisa
      // que o modelo devolveria: é o que está no quadro da pessoa.
      preservadas.set(bloco.id, { config: configAntiga, origem: "ia" });
      idsPreservados.push(bloco.id);
      continue;
    }
    aGerar.push(bloco);
  }

  return {
    aGerar: { blocos: aGerar, ligacoes: planoAjustado.ligacoes },
    preservadas,
    idsPreservados,
  };
}

/** Junta o que foi preservado com o que a etapa 2 gerou. */
export function juntarConfigs(
  preservadas: ReadonlyMap<string, ConfigResolvida>,
  geradas: ReadonlyMap<string, ConfigResolvida>,
): Map<string, ConfigResolvida> {
  const todas = new Map<string, ConfigResolvida>(preservadas);
  for (const [id, config] of geradas) todas.set(id, config);
  return todas;
}
