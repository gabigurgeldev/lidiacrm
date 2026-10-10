/**
 * O laço de retorno do limite por atendimento (`orcamento-do-turno.ts`): o dono
 * fica sabendo que o limite está cortando o agente, e onde mexer.
 *
 * UM aviso aberto por agente (`kind_e_ref`): o limite que corta um atendimento
 * costuma cortar o seguinte, e um aviso por turno enterraria a Central. Resolvido
 * o aviso, o próximo corte abre outro — é o sinal de que subir o limite não
 * bastou.
 *
 * `kind='other'` + `ref_kind` próprio, o mesmo padrão do aviso de teto do número
 * (`guardrails/before-send.ts`): sem migration da constraint de kinds.
 *
 * Falha ao avisar não derruba o turno: o cliente já foi atendido (ou o resgate
 * já rodou), e o corte fica no log.
 */
import type pg from 'pg';

import { insertInboxItem } from '../db/repository';
import type { Logger } from '../obs/logger';
import type { Estouro, GastoDoTurno, LimitesDoTurno } from './orcamento-do-turno';

export const REF_KIND_LIMITE_DO_TURNO = 'limite_do_turno';

function emDolar(centavos: number): string {
  return `US$ ${(centavos / 100).toFixed(centavos < 1 ? 4 : 2).replace('.', ',')}`;
}

export function textoDoAvisoDoLimite(d: {
  nomeDoAgente: string;
  estouro: Estouro;
  gasto: GastoDoTurno;
  limites: LimitesDoTurno;
  jaRespondeu: boolean;
}): { title: string; body: string } {
  const medida =
    d.estouro === 'tokens'
      ? `${d.gasto.tokens.toLocaleString('pt-BR')} tokens, para um limite de ${d.limites.tokens.toLocaleString('pt-BR')}`
      : `${emDolar(d.gasto.centavos)}, para um limite de ${emDolar(d.limites.centavos)}`;
  return {
    title: `O limite por atendimento cortou o agente ${d.nomeDoAgente}`,
    body:
      `Num atendimento, o agente gastou ${medida}, e parou de pensar ali. ` +
      (d.jaRespondeu
        ? 'O cliente foi respondido, mas o agente pode ter parado antes de terminar o que fazia (consultar, anotar, mover o card). '
        : 'Ele ainda não tinha respondido: foi obrigado a responder ou passar a conversa para a equipe, numa última chamada. ') +
      'Se isso se repetir, suba os limites na configuração do agente (seção de limites), ' +
      'ou reveja as instruções e as capacidades ligadas — laço de ferramenta é o que mais gasta.',
  };
}

export async function avisarLimiteDoTurno(
  db: pg.Pool,
  d: {
    tenantId: string;
    agentId: string;
    nomeDoAgente: string;
    estouro: Estouro;
    gasto: GastoDoTurno;
    limites: LimitesDoTurno;
    jaRespondeu: boolean;
    log?: Logger;
  },
): Promise<void> {
  try {
    await insertInboxItem(
      db,
      d.tenantId,
      {
        kind: 'other',
        severity: 'warn',
        ...textoDoAvisoDoLimite(d),
        refKind: REF_KIND_LIMITE_DO_TURNO,
        refId: d.agentId,
      },
      'kind_e_ref',
    );
  } catch (err) {
    d.log?.warn('aviso do limite por atendimento não foi aberto', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
  }
}
