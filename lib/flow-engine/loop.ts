/**
 * O laço que roda o motor de fluxos DENTRO do worker.
 *
 * ─── Por que ele existe ──────────────────────────────────────────────────────
 *
 * `rodarTickDeFluxos` tinha UM único acionador: o cron
 * `app/api/v1/cron/flow-engine-worker`, agendado `* * * * *` em
 * `docker/scheduler/entrypoint.sh`. Um tick por minuto, e mais nada.
 *
 * Isso não custa 60s uma vez: custa 60s A CADA RETOMADA. Medido nesta VPS em
 * 2026-09-04, lendo `flow_execution_events` de uma execução real:
 *
 *   14:28:00.78  no_avancou
 *   14:28:01.67  no_avancou          +0,9s
 *   14:28:01.73  espera_por_evento   +0,1s
 *   14:29:00.87  no_avancou         +59,1s   ← a fila do cron
 *   14:29:02.02  fluxo_concluido     +0,1s
 *
 * Os nós rodam em DÉCIMOS de segundo. O minuto inteiro é espera pelo próximo
 * tick — e todo evento cai em `HH:MM:00–02`, a assinatura do relógio. Um fluxo
 * com três esperas gasta três minutos que não são de ninguém.
 *
 * É o mesmo defeito que `lib/event-log/drain-loop.ts` já documentou para mídia
 * (103s e 188s numa cadeia de 4s) e resolveu do mesmo jeito. Este arquivo é o
 * irmão dele para os fluxos, deliberadamente na mesma forma.
 *
 * ─── O que este laço NÃO muda: as esperas configuradas ───────────────────────
 *
 * `fn_claim_due_flow_executions` só reivindica execução com `next_eval_at <=
 * now()`. Uma espera de 5 minutos continua sendo 5 minutos — ela passa a
 * RETOMAR ~2s depois de vencer, em vez de até 60s depois. O laço encurta a
 * fila, nunca o relógio do usuário.
 *
 * ─── Por que o cron continua ─────────────────────────────────────────────────
 *
 * Vira rede de segurança: worker fora do ar não pode significar fluxo parado.
 * Rodar os dois em paralelo é seguro porque o claim é a RPC atômica
 * `fn_claim_due_flow_executions`, com lease e `skip locked` — a mesma garantia
 * que já deixa o drain do event_log rodar em três acionadores.
 *
 * ─── Por que os imports são dinâmicos ────────────────────────────────────────
 *
 * Mesma razão escrita em `drain-loop.ts`: a cadeia termina em `@/lib/env`, que
 * valida ~15 variáveis e faz `throw` no topo do módulo. Importada
 * estaticamente, uma instalação com `.env` mais enxuto veria o WORKER INTEIRO
 * morrer no boot por causa de um laço acessório. O laço se desliga sozinho,
 * avisa, e o resto do worker sobe.
 */
import type { Logger } from '@/lib/agent-engine/obs/logger';
// `import type` e nunca import de valor: em runtime esta linha desaparece, e é
// isso que mantém a cadeia que termina em `@/lib/env` fora do boot do worker.
import type { TickSummary } from '@/lib/flow-engine/engine';

export interface FlowEngineLoopKnobs {
  /** Espera entre ticks que FIZERAM trabalho. */
  intervalMs: number;
  /** Espera entre ticks ociosos — o normal é não haver execução vencida. */
  idleIntervalMs: number;
}

type TickFn = () => Promise<TickSummary>;

interface Deps {
  rodarTick: TickFn;
}

/**
 * Carrega a cadeia do motor sem deixar que ela derrube o worker.
 *
 * `null` = o laço não roda (e o porquê já foi para o log). Nunca lança.
 */
async function carregarDeps(log: Logger): Promise<Deps | null> {
  try {
    const { rodarTickDeFluxos } = await import('@/lib/flow-engine/engine');
    const { garantirNosRegistrados } = await import('@/lib/flow-engine/register-all');
    const { criarFlowAdminClient, criarPortas } = await import(
      '@/lib/flow-engine/supabase-adapter'
    );
    const { createAdminClient } = await import('@/lib/supabase/admin');

    // Sem isto o registry está vazio e TODO nó vira "tipo desconhecido" — o
    // mesmo passo que a rota de cron faz antes de chamar o tick.
    garantirNosRegistrados();
    const admin = createAdminClient();
    const relogio = () => new Date();

    return {
      rodarTick: () =>
        rodarTickDeFluxos({
          db: criarFlowAdminClient(admin),
          relogio,
          portas: (exec) => criarPortas(admin, exec, relogio),
        }),
    };
  } catch (err) {
    log.warn(
      'flow-engine loop OFF — não consegui montar o motor; os fluxos seguem só pelo cron flow-engine-worker',
      { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) },
    );
    return null;
  }
}

/**
 * A regra de ritmo, sem relógio: tick que MEXEU em alguma execução mantém o
 * laço rápido; tick ocioso recua.
 *
 * `reclamadas` fica de fora da conta de propósito — ela conta o que o claim
 * TROUXE, não o que andou. Uma execução reivindicada que não avançou (bateu
 * numa espera ainda não vencida) manteria o laço no ritmo rápido girando à toa.
 *
 * `claim_falhou` acelera de propósito: o claim que não chegou ao banco é a
 * única falha que produz todos os contadores zerados, e recuar nela é ficar
 * lento justamente quando algo está errado.
 */
export function proximaEspera(resumo: TickSummary, knobs: FlowEngineLoopKnobs): number {
  const feitos =
    resumo.avancadas + resumo.esperando + resumo.concluidas + resumo.falhadas + resumo.mortas;
  return feitos > 0 || resumo.claim_falhou === true ? knobs.intervalMs : knobs.idleIntervalMs;
}

function esperar(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export async function runFlowEngineLoop(
  knobs: FlowEngineLoopKnobs,
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  const deps = await carregarDeps(log);
  if (!deps) return;

  while (!signal.aborted) {
    // Tick que EXPLODE não pode acelerar o laço: sem resumo, vale a espera
    // ociosa. Um banco fora do ar lançaria a cada iteração, e o ritmo rápido
    // transformaria a indisponibilidade numa tempestade de tentativas.
    let espera = knobs.idleIntervalMs;
    try {
      const resumo = await deps.rodarTick();
      espera = proximaEspera(resumo, knobs);
      const feitos =
        resumo.avancadas + resumo.esperando + resumo.concluidas + resumo.falhadas + resumo.mortas;
      if (feitos > 0) log.info('flow-engine loop: tick', { ...resumo });
    } catch (err) {
      log.error('flow-engine loop: tick falhou', {
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
    await esperar(espera, signal);
  }
}
