/**
 * O TETO DO DIA DO NÚMERO, CONFERIDO ANTES DE GASTAR IA.
 *
 * O aquecimento anti-ban limita quantas mensagens um número manda por dia
 * (`decidePacing`: degraus por idade + teto diário). Até aqui esse limite só era
 * conferido DENTRO da cadeia de envio, e no caminho do agente o veto vira erro
 * de ensino devolvido ao modelo pelo `send_message`. O turno terminava `ok`, com
 * zero envios e sem reagendamento: a mensagem não saía nem naquele dia, nem no
 * seguinte.
 *
 * É o mesmo defeito que a janela de horário já tinha tido (inbound-turn.ts, "ISTO
 * CONSERTA UMA MENSAGEM PERDIDA"), e a cura é a mesma: o turno é ADIADO para a
 * próxima abertura, e quem opera fica sabendo.
 *
 * ─── Quem o teto alcança ───────────────────────────────────────────────────
 *
 * Resposta a quem escreveu nas últimas 24 h NÃO consome o aquecimento
 * (`respondeAoContato` em `decidePacing`, medido em produção: a IA calava no meio
 * do pedido). Esta conferência faz a MESMA pergunta que a cadeia de envio faz,
 * com o mesmo insumo (`readLastInboundAt`): se ela adiasse um turno que o envio
 * deixaria passar, o conserto viraria o defeito. Na prática, quem chega ao teto
 * aqui é o turno que fala com quem NÃO escreveu há pouco — o follow-up.
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
 *
 * O aviso na Central é o MESMO que a cadeia de envio abre (`avisarCapDoNumero`):
 * um número no teto é um fato só, venha de onde vier a descoberta.
 */
import type pg from 'pg';

import { capabilitiesOfSession } from '@/lib/channels/capabilities';
import { loadChannelIdentity, readLastInboundAt } from '../guardrails/before-send';
import { isWindowOpen } from '../guardrails/messaging-window';
import type { Logger } from '../obs/logger';
import { decidePacing } from '../pacing/engine';
import { loadChannelKnobs, loadPacingState } from '../pacing/store';

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
 * O número já esgotou o teto de hoje PARA ESTE contato? null = pode seguir
 * (inclusive quando a resposta é "fora da janela": esse caso tem guarda própria,
 * antes desta).
 */
export async function tetoDoNumeroAtingido(
  db: pg.Pool,
  args: { tenantId: string; channelSessionId: string; contactId: string; now: Date; log?: Logger },
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
  const ultimaEntrada = await readLastInboundAt(db, args.tenantId, args.contactId, args.channelSessionId);
  const decisao = decidePacing({
    now: args.now,
    knobs: cfg.knobs,
    state,
    // O mesmo `null` que a cadeia de envio passa hoje (inbound-turn.ts): ligar
    // `channel_sessions.daily_message_limit` aqui e não lá faria a pré-checagem
    // adiar turno que o envio deixaria passar.
    crmDailyLimit: null,
    banRisk,
    // A mesma pergunta do `pacingGate`, com o mesmo insumo.
    respondeAoContato: isWindowOpen(args.now, ultimaEntrada),
  });
  if (decisao.allow) return null;
  if (decisao.code !== 'warmup_cap' && decisao.code !== 'daily_cap') return null;
  return { code: decisao.code, nextAllowedAt: decisao.nextAllowedAt, reason: decisao.reason };
}
