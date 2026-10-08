/**
 * O TETO DO DIA DO NÚMERO, CONFERIDO ANTES DE GASTAR IA.
 *
 * O aquecimento anti-ban limita quantas mensagens um número manda por dia
 * (`decidePacing`: degraus por idade + teto diário). Até aqui esse limite só era
 * conferido DENTRO da cadeia de envio, e no caminho do agente o veto vira erro
 * de ensino devolvido ao modelo pelo `send_message`. O turno terminava `ok`, com
 * zero envios, sem reagendamento e sem aviso: o cliente escrevia depois da 20ª
 * mensagem do dia e não recebia nada — nem naquele dia, nem no seguinte.
 *
 * É o mesmo defeito que a janela de horário já tinha tido (inbound-turn.ts, "ISTO
 * CONSERTA UMA MENSAGEM PERDIDA"), e a cura é a mesma: o turno é ADIADO para a
 * próxima abertura, e quem opera fica sabendo.
 *
 * ─── Por que conferir antes não adia turno que teria passado ────────────────
 *
 * `sentToday` só CRESCE dentro do dia local: se o teto já foi atingido agora, ele
 * continua atingido na hora do envio, segundos depois. A exceção é a virada da
 * meia-noite no meio do turno, e ela é benigna — o turno roda de novo na
 * abertura seguinte. A janela e o throttle continuam com a cadeia de envio, que
 * é quem os aplica sob o lock do número.
 *
 * Canal sem risco de banimento (`banRisk: false`, ex.: API oficial) não tem teto
 * de aquecimento: `decidePacing` já desarma essa parte, e aqui nada adia.
 */
import type pg from 'pg';

import { capabilitiesOfSession } from '@/lib/channels/capabilities';
import { insertInboxItem } from '../db/repository';
import { loadChannelIdentity } from '../guardrails/before-send';
import type { Logger } from '../obs/logger';
import { decidePacing } from '../pacing/engine';
import { loadChannelKnobs, loadPacingState } from '../pacing/store';

/** ref_kind do aviso — o id é o `channel_session_id`. */
export const REF_KIND_TETO = 'teto_do_numero';

export interface TetoDoNumeroAtingido {
  code: 'warmup_cap' | 'daily_cap';
  /** Próxima abertura da janela (com jitter) — quando o turno volta a rodar. */
  nextAllowedAt: Date;
  /** Explicação pt-br do motor ("cap de warm-up atingido (20/dia …)"). */
  reason: string;
}

/**
 * O que o modelo lê quando o envio é vetado pelo teto. Não há o que ele
 * reescrever: a instrução é PARAR, porque o turno inteiro será adiado.
 */
export const MENSAGEM_DO_TETO =
  'o número atingiu o limite de mensagens de hoje — não tente enviar de novo neste turno; ' +
  'o sistema responde o cliente na próxima abertura. Encerre o turno agora.';

/**
 * O veto da cadeia de envio é do teto do dia? Devolve o teto com a abertura
 * seguinte, ou null para qualquer outro veto (janela, spinning, promessa…).
 */
export function vetoDeTetoDoNumero(veto: {
  code: string;
  message: string;
  nextAllowedAt?: Date;
}): TetoDoNumeroAtingido | null {
  if (veto.code !== 'warmup_cap' && veto.code !== 'daily_cap') return null;
  if (veto.nextAllowedAt === undefined) return null;
  return { code: veto.code, nextAllowedAt: veto.nextAllowedAt, reason: veto.message };
}

/**
 * O número já esgotou o teto de hoje? null = pode seguir (inclusive quando a
 * resposta é "fora da janela": esse caso tem guarda própria, antes desta).
 */
export async function tetoDoNumeroAtingido(
  db: pg.Pool,
  args: { tenantId: string; channelSessionId: string; now: Date; log?: Logger },
): Promise<TetoDoNumeroAtingido | null> {
  const cfg = await loadChannelKnobs(db, args.tenantId, args.channelSessionId, args.log);
  const canal = await loadChannelIdentity(db, args.tenantId, args.channelSessionId);
  const { banRisk } = capabilitiesOfSession({ provider: canal.provider, mode: canal.mode });
  if (!banRisk) return null;

  const state = await loadPacingState(db, args.tenantId, args.channelSessionId, {
    now: args.now,
    timezone: cfg.knobs.timezone,
    numberActivatedAt: cfg.numberActivatedAt,
  });
  const decisao = decidePacing({
    now: args.now,
    knobs: cfg.knobs,
    state,
    // O mesmo `null` que a cadeia de envio passa hoje (inbound-turn.ts): ligar
    // `channel_sessions.daily_message_limit` aqui e não lá faria a pré-checagem
    // adiar turno que o envio deixaria passar.
    crmDailyLimit: null,
    banRisk,
  });
  if (decisao.allow) return null;
  if (decisao.code !== 'warmup_cap' && decisao.code !== 'daily_cap') return null;
  return { code: decisao.code, nextAllowedAt: decisao.nextAllowedAt, reason: decisao.reason };
}

/**
 * O laço de retorno: o operador fica sabendo que o número parou de responder
 * hoje, e onde mexer. UM aviso aberto por número (dedupe por kind+ref) — a
 * 21ª, a 22ª e a 30ª mensagem do dia não abrem três avisos.
 *
 * Falha ao avisar não derruba nada: o turno já foi adiado, e o motivo está no
 * log e no `last_error` do job.
 */
export async function avisarTetoDoNumero(
  db: pg.Pool,
  args: { tenantId: string; channelSessionId: string; teto: TetoDoNumeroAtingido; log?: Logger },
): Promise<void> {
  const aquecimento = args.teto.code === 'warmup_cap';
  try {
    await insertInboxItem(
      db,
      args.tenantId,
      {
        kind: 'teto_do_numero',
        severity: 'warn',
        title: aquecimento
          ? 'Um número atingiu o limite de aquecimento de hoje e o agente parou de responder'
          : 'Um número atingiu o limite de mensagens de hoje e o agente parou de responder',
        body:
          `Motivo: ${args.teto.reason}. As mensagens que chegarem agora serão respondidas ` +
          `na próxima abertura (${args.teto.nextAllowedAt.toISOString()}). ` +
          (aquecimento
            ? 'O limite cresce com a idade do número. Se ele já era usado antes de ser ' +
              'conectado aqui, informe desde quando em Conexões › Proteção de envio — ou ' +
              'marque que ele já está aquecido.'
            : 'O limite diário fica em Conexões › Proteção de envio.'),
        // ref_kind PRÓPRIO, não 'channel_session': `lib/channels/health.ts` resolve todo
        // aviso aberto com esse ref_kind quando a conexão volta a ficar saudável — e
        // um teto de aquecimento não acaba porque a conexão está boa.
        refKind: REF_KIND_TETO,
        refId: args.channelSessionId,
      },
      'kind_e_ref',
    );
  } catch (err) {
    args.log?.warn('aviso de teto do número não foi aberto — turno já adiado', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
  }
}
