/**
 * Execuções do agente — o registro que a tela lia e o motor nunca escrevia.
 *
 * ## O defeito
 *
 * A aba **Execuções** do agente lê `ai_agent_runs` (`/api/v1/ai/agents/:id/runs`).
 * Quem escrevia ali era o runtime antigo (`lib/ai/runtime`) e o dispatcher
 * legado, hoje NO-OP. O motor vivo (`lib/agent-engine`) atende todo cliente e
 * nunca gravou uma linha: a aba ficava vazia numa instalação que respondia
 * centenas de mensagens por dia, e o dono concluía que o agente não rodava.
 *
 * ## O que é gravado
 *
 * UMA linha por turno que fala com o cliente e tem agente publicado, escrita no
 * FIM do turno (no `finally` de `runAgentTurn`), já com o desfecho. Não há linha
 * `running` no começo, de propósito:
 *
 *  - o índice `ai_agent_runs_one_running_per_conv` aceita UMA `running` por
 *    conversa — um turno morto no meio deixaria a linha presa e o próximo
 *    INSERT falharia;
 *  - a tabela tem gatilho de auditoria por linha (`trg_ai_agent_runs_audit`);
 *    início + fim seriam duas linhas de auditoria por mensagem respondida.
 *
 * O preço declarado: um processo morto por SIGKILL no meio do turno não deixa
 * linha. Esse caso já tem dono — o job volta à fila e, esgotado, vira aviso
 * `job_dead` na Central.
 *
 * Turno sem agente publicado (o agente genérico) não entra: `agent_id` e
 * `agent_version_id` são obrigatórios, e não há aba de agente onde mostrá-lo.
 *
 * ## Tokens e custo
 *
 * Vêm de `llm_calls` do próprio job desde o início do turno — TODAS as
 * chamadas, inclusive classificadores e checkpoint, porque é isso que o turno
 * custou. Somar só o laço principal mostraria um número menor que a conta.
 *
 * ## Nunca derruba o turno
 *
 * É telemetria: qualquer falha aqui vira `log.warn` e o atendimento segue.
 */

import type pg from 'pg';

import type { Logger } from '../obs/logger';

/** Por que o turno não seguiu o caminho normal — vocabulário de `abort_reason`. */
export type MotivoDoTurno =
  /** Fora do horário de funcionamento da versão: adiado para a abertura. */
  | 'fora_do_horario'
  /** O limite por atendimento cortou o laço do agente. */
  | 'limite_do_turno'
  /** O turno terminou sem mensagem ao cliente e sem passagem para humano. */
  | 'sem_resposta'
  /** O motor reagendou o turno por outro motivo (ritmo, teto do número). */
  | 'adiado';

export interface PassoDeFerramenta {
  step: number;
  tool_name: string;
  args: unknown;
  result: unknown;
}

export interface RegistroDoTurno {
  /** Relógio REAL do início (não o `deps.clock`, que os testes congelam). */
  inicio: Date;
  agente: { agentId: string; versionId: string } | null;
  motivo: MotivoDoTurno | null;
  passos: number;
  ferramentas: PassoDeFerramenta[];
  /** Mensagens que saíram (ou ficaram na fila) para o cliente neste turno. */
  enviadas: number;
}

export function novoRegistroDoTurno(agora: Date = new Date()): RegistroDoTurno {
  return { inicio: agora, agente: null, motivo: null, passos: 0, ferramentas: [], enviadas: 0 };
}

export type StatusDoTurno = 'completed' | 'failed' | 'aborted' | 'handoff';

/**
 * O desfecho que a tela mostra. `adiado` = o turno lançou `JobSettledError`
 * (o job foi reagendado, não falhou).
 */
export function statusDoTurno(input: {
  erro: boolean;
  adiado: boolean;
  enviadas: number;
  passouParaHumano: boolean;
  motivo: MotivoDoTurno | null;
}): { status: StatusDoTurno; abortReason: MotivoDoTurno | null } {
  if (input.adiado) return { status: 'aborted', abortReason: input.motivo ?? 'adiado' };
  if (input.erro) return { status: 'failed', abortReason: input.motivo };
  if (input.enviadas > 0) return { status: 'completed', abortReason: input.motivo };
  if (input.passouParaHumano) return { status: 'handoff', abortReason: input.motivo };
  return { status: 'aborted', abortReason: input.motivo ?? 'sem_resposta' };
}

const TETO_DO_JSON = 2000;

/** JSON de entrada/saída de ferramenta, aparado para não inflar a linha. */
function aparar(valor: unknown): unknown {
  if (valor === undefined) return null;
  let texto: string;
  try {
    texto = JSON.stringify(valor);
  } catch {
    return String(valor).slice(0, TETO_DO_JSON);
  }
  if (texto === undefined) return null;
  if (texto.length <= TETO_DO_JSON) return valor;
  return `${texto.slice(0, TETO_DO_JSON)}… (aparado)`;
}

interface PassoDoModelo {
  toolCalls?: ReadonlyArray<{ toolCallId?: string; toolName: string; input?: unknown }>;
  toolResults?: ReadonlyArray<{ toolCallId?: string; toolName: string; output?: unknown }>;
}

/** Os passos do laço do agente, no formato que `RunTrace` desenha. */
export function ferramentasDosPassos(passos: ReadonlyArray<PassoDoModelo>, desde = 0): PassoDeFerramenta[] {
  const saida: PassoDeFerramenta[] = [];
  passos.forEach((p, i) => {
    for (const chamada of p.toolCalls ?? []) {
      const resultado = (p.toolResults ?? []).find((r) =>
        chamada.toolCallId !== undefined ? r.toolCallId === chamada.toolCallId : r.toolName === chamada.toolName,
      );
      saida.push({
        step: desde + i + 1,
        tool_name: chamada.toolName,
        args: aparar(chamada.input),
        result: aparar(resultado?.output),
      });
    }
  });
  return saida;
}

export interface ContextoDoRegistro {
  tenantId: string;
  jobId: string;
  leadId: string;
  conversationId: string;
  channelSessionId: string;
  inboundMessageId: string | null;
}

/**
 * Grava a linha do turno. Sem agente resolvido, não grava nada. Nunca lança.
 */
export async function gravarRegistroDoTurno(
  pool: pg.Pool,
  ctx: ContextoDoRegistro,
  registro: RegistroDoTurno,
  desfecho: { erro: unknown; adiado: boolean; passouParaHumano: () => Promise<boolean> },
  log: Logger,
): Promise<void> {
  if (registro.agente === null) return;
  try {
    const { rows: soma } = await pool.query<{
      tokens_in: string | null;
      tokens_out: string | null;
      cost_cents: string | null;
    }>(
      `select sum(input_tokens) as tokens_in, sum(output_tokens) as tokens_out, sum(cost_cents) as cost_cents
         from llm_calls
        where organization_id = $1 and job_id = $2 and created_at >= $3`,
      [ctx.tenantId, ctx.jobId, registro.inicio],
    );
    const { rows: saida } = await pool.query<{ id: string }>(
      `select id from messages
        where organization_id = $1 and conversation_id = $2 and direction = 'outbound' and created_at >= $3
        order by created_at desc, id desc limit 1`,
      [ctx.tenantId, ctx.conversationId, registro.inicio],
    );
    const erro = desfecho.erro !== null && !desfecho.adiado;
    const { status, abortReason } = statusDoTurno({
      erro,
      adiado: desfecho.adiado,
      enviadas: registro.enviadas,
      passouParaHumano: erro || desfecho.adiado || registro.enviadas > 0 ? false : await desfecho.passouParaHumano(),
      motivo: registro.motivo,
    });
    const mensagemDeErro =
      desfecho.erro === null
        ? null
        : (desfecho.erro instanceof Error ? desfecho.erro.message : String(desfecho.erro)).slice(0, 500);
    const fim = new Date();
    await pool.query(
      `insert into ai_agent_runs
         (organization_id, agent_id, agent_version_id, conversation_id, contact_id, channel_session_id,
          inbound_message_id, outbound_message_id, status, abort_reason, error_code, error_message,
          tokens_in, tokens_out, cost_cents, latency_ms, steps_count, tool_calls, is_dry_run,
          started_at, completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,false,$19,$20)`,
      [
        ctx.tenantId,
        registro.agente.agentId,
        registro.agente.versionId,
        ctx.conversationId,
        ctx.leadId,
        ctx.channelSessionId,
        ctx.inboundMessageId,
        saida[0]?.id ?? null,
        status,
        abortReason,
        erro ? 'turno_falhou' : null,
        mensagemDeErro,
        Number(soma[0]?.tokens_in ?? 0),
        Number(soma[0]?.tokens_out ?? 0),
        Number(soma[0]?.cost_cents ?? 0),
        fim.getTime() - registro.inicio.getTime(),
        registro.passos,
        JSON.stringify(registro.ferramentas),
        registro.inicio,
        fim,
      ],
    );
  } catch (err) {
    log.warn('execução do agente não registrada (ai_agent_runs)', {
      error: (err instanceof Error ? err.message : String(err)).slice(0, 160),
    });
  }
}
