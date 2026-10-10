/**
 * QUANTO O AGENTE DE FATO GASTA POR ATENDIMENTO — para calibrar os limites.
 *
 * Os limites por atendimento (`lib/agent-engine/agent/orcamento-do-turno.ts`)
 * passaram a valer. Um limite escolhido no escuro corta atendimento bom (baixo
 * demais) ou não protege nada (alto demais). Ao lado dos campos, a tela mostra
 * o que os atendimentos reais deste agente gastaram, e quantos o limite que
 * está no formulário teria cortado.
 *
 * Conta como o motor conta: tokens NOVOS (entrada fora do cache + saída) e
 * centavos de dólar, das chamadas `agent_turn` de cada turno (um turno = um
 * `job_id`). Funções puras: a rota agrupa, a tela recalcula o "teria cortado"
 * enquanto o dono digita.
 */

export interface LinhaDeChamada {
  job_id: string | null;
  input_tokens: number | null;
  cache_read_tokens: number | null;
  output_tokens: number | null;
  /** `numeric` chega como string do PostgREST/node-pg. */
  cost_cents: number | string | null;
}

export interface GastoDeUmAtendimento {
  tokens: number;
  /** null = alguma chamada sem preço conhecido. */
  centavos: number | null;
}

/** Agrupa as chamadas por turno (`job_id`). Chamada sem job vira um atendimento sozinha. */
export function agruparPorAtendimento(linhas: readonly LinhaDeChamada[]): GastoDeUmAtendimento[] {
  const porJob = new Map<string, GastoDeUmAtendimento>();
  const avulsos: GastoDeUmAtendimento[] = [];
  for (const l of linhas) {
    const tokens = Math.max(0, (l.input_tokens ?? 0) - (l.cache_read_tokens ?? 0)) + (l.output_tokens ?? 0);
    const custo = l.cost_cents === null ? null : Number(l.cost_cents);
    const parcela: GastoDeUmAtendimento = { tokens, centavos: custo !== null && Number.isFinite(custo) ? custo : null };
    if (l.job_id === null) {
      avulsos.push(parcela);
      continue;
    }
    const atual = porJob.get(l.job_id);
    porJob.set(
      l.job_id,
      atual === undefined
        ? parcela
        : {
            tokens: atual.tokens + parcela.tokens,
            centavos: atual.centavos === null || parcela.centavos === null ? null : atual.centavos + parcela.centavos,
          },
    );
  }
  return [...porJob.values(), ...avulsos];
}

/** Percentil por posição (nearest-rank). Lista vazia = null. */
export function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return ordenados[i]!;
}

export interface ResumoDoConsumo {
  atendimentos: number;
  tokens: { p50: number | null; p95: number | null; maior: number | null };
  centavos: { p50: number | null; p95: number | null; maior: number | null };
  /** Quantos atendimentos o limite do formulário teria cortado. */
  cortados: number;
}

export function resumirConsumo(
  atendimentos: readonly GastoDeUmAtendimento[],
  limites: { tokens: number; centavos: number },
): ResumoDoConsumo {
  const tokens = atendimentos.map((a) => a.tokens);
  const centavos = atendimentos.flatMap((a) => (a.centavos === null ? [] : [a.centavos]));
  return {
    atendimentos: atendimentos.length,
    tokens: { p50: percentil(tokens, 50), p95: percentil(tokens, 95), maior: percentil(tokens, 100) },
    centavos: { p50: percentil(centavos, 50), p95: percentil(centavos, 95), maior: percentil(centavos, 100) },
    cortados: atendimentos.filter(
      (a) => a.tokens >= limites.tokens || (a.centavos !== null && a.centavos >= limites.centavos),
    ).length,
  };
}
