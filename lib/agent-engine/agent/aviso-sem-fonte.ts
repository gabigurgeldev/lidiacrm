/**
 * "Não tenho essa informação" — a fala do RUNTIME quando o agente insistiu em
 * afirmar sem fonte e a organização não tem equipe para chamar (`so_agente`).
 *
 * É o irmão de `aviso-de-escalacao.ts` para o outro modo: lá a saída honesta é
 * passar a conversa; aqui é dizer que não sabe, sem prometer retorno, fila nem
 * que alguém vai responder — numa empresa sem ninguém na Caixa de entrada, essa
 * promessa seria a segunda invenção do turno.
 *
 * Mesmas escolhas de cadeia do aviso de escalação, pelos mesmos motivos:
 *  - sai por `runBeforeSend` (stop, LGPD, janela e pacing continuam valendo);
 *  - `enforceSpinning: false` + variantes sorteadas pelo lead: texto de código
 *    repetido entre leads cairia no veto de repetição e viraria silêncio;
 *  - SEM o gate de fundamentação (o campo `grounding` não vai): a frase não
 *    afirma nada da empresa, e vetá-la seria o guarda calando a saída que ele
 *    mesmo pediu;
 *  - `seq` próprio, fora da faixa do turno (1..n) e do aviso de escalação (0),
 *    para o replay do job deduplicar por `(job_id, seq)` sem colidir.
 *
 * NUNCA lança: o turno já está no caminho de erro, e um throw aqui derrubaria o
 * job inteiro — o cliente ficaria sem resposta e o job seria refeito do zero.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';

import type { ChannelAdapter } from '../channel-adapter';
import { runBeforeSend } from '../guardrails/before-send';
import type { LgpdInput } from '../guardrails/lgpd/legal-basis';
import type { Logger } from '../obs/logger';

/** Fora de 1..n (turno) e de 0 (aviso de escalação). */
export const SEQ_DO_AVISO_SEM_FONTE = 90;

/**
 * Variantes de verdade, não sinônimos: o gate de repetição mede Jaccard, e um
 * spin superficial cai nele do mesmo jeito (ver `aviso-ao-lead.ts`).
 */
export const VARIANTES_SEM_FONTE: readonly string[] = [
  'Essa informação eu não tenho aqui, e prefiro não te responder errado. Posso te ajudar com outra coisa?',
  'Sobre isso eu não consigo te informar com certeza por aqui. Tem mais alguma dúvida em que eu possa ajudar?',
  'Não encontrei esse dado no que tenho disponível, então não vou arriscar uma resposta. Quer saber de outro assunto?',
];

export function textoSemFonte(leadId: string): string {
  const digest = createHash('sha256').update(leadId).digest();
  return VARIANTES_SEM_FONTE[digest.readUInt32BE(0) % VARIANTES_SEM_FONTE.length]!;
}

export type DesfechoSemFonte = { enviado: true } | { enviado: false; porque: string };

export async function avisarSemFonte(
  pool: pg.Pool,
  ids: { tenantId: string; leadId: string; conversationId: string; channelSessionId: string; jobId: string },
  opts: {
    channel: ChannelAdapter;
    optedOutThisTurn: boolean;
    now: Date;
    log: Logger;
    lgpd?: LgpdInput;
    agentId?: string | null;
    disclosureMode?: 'inject' | 'veto';
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<DesfechoSemFonte> {
  try {
    const chain = await runBeforeSend({
      pool,
      log: opts.log,
      tenantId: ids.tenantId,
      leadId: ids.leadId,
      jobId: ids.jobId,
      channelSessionId: ids.channelSessionId,
      body: textoSemFonte(ids.leadId),
      optedOutThisTurn: opts.optedOutThisTurn,
      enforceSpinning: false,
      crmDailyLimit: null,
      now: opts.now,
      ...(opts.sleep !== undefined ? { sleep: opts.sleep } : {}),
      ...(opts.lgpd !== undefined ? { lgpd: opts.lgpd } : {}),
      ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
      ...(opts.disclosureMode !== undefined ? { disclosureMode: opts.disclosureMode } : {}),
      send: (finalBody) =>
        opts.channel.send({
          tenantId: ids.tenantId,
          leadId: ids.leadId,
          jobId: ids.jobId,
          seq: SEQ_DO_AVISO_SEM_FONTE,
          conversationId: ids.conversationId,
          body: finalBody,
        }),
    });
    if (chain.status === 'vetoed') return { enviado: false, porque: chain.code };
    switch (chain.outcome.kind) {
      case 'sent':
      case 'already_sent':
      case 'queued':
        return { enviado: true };
      case 'blocked':
        return { enviado: false, porque: 'contato_bloqueado' };
      case 'failed':
        return { enviado: false, porque: 'canal_falhou' };
      case 'unavailable':
        return { enviado: false, porque: 'canal_indisponivel' };
    }
  } catch (err) {
    opts.log.warn('aviso de "não tenho essa informação" falhou', {
      error: err instanceof Error ? err.message.slice(0, 200) : 'erro desconhecido',
    });
    return { enviado: false, porque: 'erro_no_envio' };
  }
}
