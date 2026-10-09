/**
 * O TURNO QUE TERMINA SEM RESPONDER AO CLIENTE.
 *
 * O cliente escreveu, o modelo rodou, e nada saiu. Dois jeitos comuns:
 *
 *  - o modelo escreveu a resposta como TEXTO, em vez de chamar `send_message`.
 *    O runtime descarta texto solto de propósito (só sai o que passa pela cadeia
 *    de conferências), então a resposta existia e o cliente não a recebia;
 *  - o modelo simplesmente encerrou sem dizer nada.
 *
 * Nos dois, o turno terminava "ok", o log dizia `messages_sent: 0` em nível
 * info, e ninguém ficava sabendo — o mesmo padrão "status verde, mensagem
 * ausente" das seis causas medidas em `docs/testing/user-journey-map.md`.
 *
 * ─── O que acontece agora ──────────────────────────────────────────────────
 *
 *  1. Sem veto nenhum no turno: o modelo é COBRADO uma vez, só com as
 *     ferramentas de falar com o cliente e com chamada de ferramenta
 *     obrigatória. É o caso em que a resposta quase sempre já está pronta.
 *  2. Ainda nada (ou o turno teve vetos que o modelo não contornou): abre
 *     `turno_sem_resposta` na Central, um por conversa.
 *
 * ─── Silêncio que é CERTO, e por isso não aciona nada ──────────────────────
 *
 *  - turno que não é resposta a cliente (follow-up que classifica, Operador);
 *  - cliente bloqueado (opt-out é irrevogável — calar é a regra);
 *  - conversa passada para uma pessoa neste turno (o aviso ao cliente sai pelo
 *    handoff, fora da contagem de envios);
 *  - veto que JÁ tem dono: opt-out, LGPD (que escala sozinha), janela de 24 h da
 *    API oficial e janela anti-ban (que adia o turno antes de chegar aqui).
 */
import type pg from 'pg';

import { insertInboxItem } from '../db/repository';
import type { Logger } from '../obs/logger';

/** Vetos cujo silêncio é a regra funcionando — nem resgate, nem aviso. */
const VETOS_QUE_CALAM_POR_REGRA: ReadonlySet<string> = new Set([
  'contato_bloqueado',
  'lgpd_anonymized',
  'lgpd_missing_legal_basis',
  'messaging_window_closed',
  'outside_window',
]);

/** Só estes turnos são RESPOSTA ao que o cliente disse. */
const TURNOS_QUE_RESPONDEM: ReadonlySet<string> = new Set(['inbound_turn', 'case_reply_turn']);

export type AcaoDoTurnoMudo = 'nada' | 'cobrar_resposta' | 'avisar';

export function decidirResgateDoTurnoMudo(entrada: {
  kind: string;
  algoSaiu: boolean;
  clienteBloqueado: boolean;
  vetos: readonly string[];
  passouParaHumano: boolean;
}): { acao: AcaoDoTurnoMudo } {
  if (!TURNOS_QUE_RESPONDEM.has(entrada.kind)) return { acao: 'nada' };
  if (entrada.algoSaiu || entrada.clienteBloqueado || entrada.passouParaHumano) return { acao: 'nada' };
  if (entrada.vetos.some((v) => VETOS_QUE_CALAM_POR_REGRA.has(v))) return { acao: 'nada' };
  // Houve veto e o modelo não contornou: cobrar de novo bateria na mesma
  // conferência. Quem decide agora é uma pessoa.
  if (entrada.vetos.length > 0) return { acao: 'avisar' };
  return { acao: 'cobrar_resposta' };
}

/** O que o modelo lê no passo de resgate. */
export const MENSAGEM_DE_RESGATE =
  'Você terminou o turno sem enviar nada ao cliente — ele continua esperando. Texto escrito fora ' +
  'de ferramenta NÃO chega a ele. Envie agora a sua resposta com send_message; se este atendimento ' +
  'não é para você, passe a conversa para uma pessoa com request_human_handoff.';

/**
 * O laço de retorno: quem opera fica sabendo que um cliente ficou sem resposta.
 * Um aviso aberto por conversa (dedupe por kind+contato). Falha ao avisar não
 * derruba o turno — o motivo fica no log.
 */
export async function avisarTurnoSemResposta(
  db: pg.Pool,
  args: {
    tenantId: string;
    leadId: string;
    motivo: 'nao_respondeu' | 'barrado';
    vetos: readonly string[];
    log?: Logger;
  },
): Promise<void> {
  const porque =
    args.motivo === 'barrado'
      ? `As tentativas de resposta foram barradas pelas conferências de envio (${[...new Set(args.vetos)].join(', ')}) ` +
        'e o agente não conseguiu reescrever.'
      : 'O agente encerrou o atendimento sem chamar a ferramenta de resposta, mesmo depois de ser cobrado.';
  try {
    await insertInboxItem(
      db,
      args.tenantId,
      {
        kind: 'turno_sem_resposta',
        severity: 'warn',
        title: 'O agente terminou um atendimento sem responder ao cliente',
        body:
          `${porque} Abra a conversa e responda. Se acontecer com frequência, confira as ` +
          'instruções do agente e o modelo escolhido (modelos marcados "Não usa ferramentas" ' +
          'não conseguem responder) — e o botão Testar do agente.',
        refKind: 'contact',
        refId: args.leadId,
      },
      'kind_e_ref',
    );
  } catch (err) {
    args.log?.warn('aviso de turno sem resposta não foi aberto', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
  }
}
