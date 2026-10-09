/**
 * O LIMITE DE UM ATENDIMENTO: QUANTO O AGENTE PODE GASTAR PARA RESPONDER UMA VEZ.
 *
 * A tela do agente sempre teve "Limite de tokens por atendimento" e "Limite de
 * custo por atendimento" (`ai_agent_versions.token_budget` /
 * `cost_budget_cents`). O motor nunca os leu: um agente que entrasse em laço de
 * ferramenta gastava até o teto de passos, por mais caro que cada passo fosse,
 * com os dois campos salvos e aparecendo na tela como se valessem.
 *
 * ─── O que conta ───────────────────────────────────────────────────────────
 *
 * O laço de raciocínio do agente — as chamadas de modelo que decidem o que
 * responder e quais ferramentas usar. É ali que um turno sai do controle (uma
 * ferramenta que falha e o modelo tenta de novo, uma busca atrás da outra).
 * Ficam de fora:
 *  - o checkpoint do fim do turno: é o que guarda o que a conversa decidiu, e
 *    cortá-lo trocaria um gasto pequeno por memória perdida;
 *  - os classificadores da abertura (etapa, roteador, promessa): custo fixo
 *    por turno, que o dono não controla por estes campos.
 * O ORÇAMENTO MENSAL da organização (`comHandoffSeOrcamentoAcabar`) continua
 * cobrindo tudo, inclusive o que fica de fora daqui.
 *
 * ─── Tokens NOVOS, não relidos ─────────────────────────────────────────────
 *
 * Cada passo do laço reenvia o contexto inteiro, e o prefixo estável (instruções
 * e ferramentas) volta do cache do provedor a cada vez. Contar essa releitura
 * faria um agente de prompt grande "gastar" o limite só por pensar em passos —
 * o MESMO texto contado oito vezes. O limite de tokens conta o que é novo:
 * entrada fora do cache + saída. O custo já desconta o cache pelo preço.
 *
 * ─── O que acontece quando acaba ───────────────────────────────────────────
 *
 * O laço PARA no passo em que o gasto alcança o limite (`stopWhen`), e o que
 * vem depois decide `decidirAposOLimite`:
 *  - já respondeu o cliente → o turno fecha normal;
 *  - não respondeu → o resgate do turno mudo (`turno-mudo.ts`) dá ao modelo
 *    UMA última chamada, só com responder/passar para a equipe, obrigatória.
 *    É a mesma regra de "não terminar sem responder", e por isso o limite
 *    nunca vira cliente sem resposta.
 * Nos dois casos a Central recebe UM aviso por agente por dia: o dono precisa
 * saber que o limite está cortando atendimentos, e se é hora de subi-lo.
 */

export interface LimitesDoTurno {
  /** `ai_agent_versions.token_budget`. */
  tokens: number;
  /** `ai_agent_versions.cost_budget_cents` — centavos de DÓLAR, como `llm_calls.cost_cents`. */
  centavos: number;
}

export interface GastoDoTurno {
  tokens: number;
  centavos: number;
  /** Alguma chamada sem tabela de preço: o custo é piso, e só o limite de tokens é confiável. */
  semPreco: boolean;
}

export const GASTO_ZERO: GastoDoTurno = { tokens: 0, centavos: 0, semPreco: false };

export type Estouro = 'tokens' | 'custo';

/** O limite foi alcançado? Tokens primeiro: é o que vale mesmo sem preço conhecido. */
export function estouroDoTurno(gasto: GastoDoTurno, limites: LimitesDoTurno): Estouro | null {
  if (gasto.tokens >= limites.tokens) return 'tokens';
  if (gasto.centavos >= limites.centavos) return 'custo';
  return null;
}

/** O uso de um passo, no formato do SDK de IA. */
export interface UsoDoPasso {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  inputTokenDetails?: { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined };
}

export interface UsoEmTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Soma o gasto de passos a um gasto anterior. `custo` é o preço do modelo (null = sem preço). */
export function somarGasto(
  anterior: GastoDoTurno,
  passos: readonly { usage: UsoDoPasso }[],
  custo: (uso: UsoEmTokens) => number | null,
): GastoDoTurno {
  let { tokens, centavos, semPreco } = anterior;
  for (const { usage } of passos) {
    const uso: UsoEmTokens = {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
    };
    tokens += Math.max(0, uso.inputTokens - uso.cacheReadTokens) + uso.outputTokens;
    const c = custo(uso);
    if (c === null) semPreco = true;
    else centavos += c;
  }
  return { tokens, centavos, semPreco };
}

export type DepoisDoLimite = 'seguir' | 'forcar_resposta' | 'fechar';

/**
 * O que o turno faz depois do laço. `seguir` = o limite não foi alcançado.
 * `forcar_resposta` não roda nada por si: é o resgate do turno mudo que dá a
 * última chamada — esta função só diz POR QUE, para o aviso e o log.
 */
export function decidirAposOLimite(d: { estouro: Estouro | null; jaRespondeu: boolean }): DepoisDoLimite {
  if (d.estouro === null) return 'seguir';
  return d.jaRespondeu ? 'fechar' : 'forcar_resposta';
}
