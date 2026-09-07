/**
 * O laço que roda o motor de fluxos dentro do worker.
 *
 * O que estes testes protegem, e por quê (medido em produção, 2026-09-04):
 * `rodarTickDeFluxos` só tinha o cron `flow-engine-worker`, 1×/min. Lendo
 * `flow_execution_events` de uma execução real, os nós rodavam em 0,1–0,9s e a
 * RETOMADA depois de uma espera custava **59,1s** — com todo evento caindo em
 * `HH:MM:00–02`, a assinatura do relógio. Um fluxo com três esperas gastava
 * três minutos que não eram de ninguém.
 *
 * O caso que carrega o arquivo é o último: espera CONFIGURADA continua
 * intacta. O laço encurta a fila, nunca o relógio do usuário.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@/lib/agent-engine/obs/logger';
import type { TickSummary } from '@/lib/flow-engine/engine';

const rodarTickDeFluxos = vi.fn();
const garantirNosRegistrados = vi.fn();
const criarFlowAdminClient = vi.fn(() => ({ marcador: 'db' }));
const criarPortas = vi.fn(() => ({ marcador: 'portas' }));
const createAdminClient = vi.fn(() => ({ marcador: 'admin' }));

vi.mock('@/lib/flow-engine/engine', () => ({ rodarTickDeFluxos }));
vi.mock('@/lib/flow-engine/register-all', () => ({ garantirNosRegistrados }));
vi.mock('@/lib/flow-engine/supabase-adapter', () => ({ criarFlowAdminClient, criarPortas }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient }));

const { proximaEspera, runFlowEngineLoop } = await import('@/lib/flow-engine/loop');

const knobs = { intervalMs: 2_000, idleIntervalMs: 10_000 };
const vazio: TickSummary = {
  reclamadas: 0,
  avancadas: 0,
  esperando: 0,
  concluidas: 0,
  falhadas: 0,
  mortas: 0,
};
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const logger = log as unknown as Logger;

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClient.mockReturnValue({ marcador: 'admin' });
});

describe('proximaEspera — a regra de ritmo', () => {
  it('⭐ tick que MEXEU em alguma execução mantém o laço rápido', () => {
    for (const campo of ['avancadas', 'esperando', 'concluidas', 'falhadas', 'mortas'] as const) {
      expect(proximaEspera({ ...vazio, reclamadas: 1, [campo]: 1 }, knobs)).toBe(knobs.intervalMs);
    }
  });

  it('⭐ tick ocioso recua para a espera longa', () => {
    expect(proximaEspera(vazio, knobs)).toBe(knobs.idleIntervalMs);
  });

  it('⭐ `reclamadas` sozinha NÃO acelera — ela conta o que o claim trouxe, não o que andou', () => {
    // Execução reivindicada que não avançou (bateu numa espera ainda não
    // vencida) manteria o laço no ritmo rápido girando à toa.
    expect(proximaEspera({ ...vazio, reclamadas: 5 }, knobs)).toBe(knobs.idleIntervalMs);
  });

  it('⭐ claim que FALHOU acelera — é a única falha com todos os contadores zerados', () => {
    // Recuar aqui seria ficar lento justamente quando algo está errado.
    expect(proximaEspera({ ...vazio, claim_falhou: true }, knobs)).toBe(knobs.intervalMs);
  });
});

describe('runFlowEngineLoop', () => {
  it('⭐ registra os nós ANTES do primeiro tick — sem isso todo tipo é desconhecido', async () => {
    rodarTickDeFluxos.mockResolvedValue(vazio);
    const abort = new AbortController();
    const laco = runFlowEngineLoop({ intervalMs: 1, idleIntervalMs: 1 }, logger, abort.signal);
    await new Promise((r) => setTimeout(r, 10));
    abort.abort();
    await laco;

    expect(garantirNosRegistrados).toHaveBeenCalled();
    expect(rodarTickDeFluxos).toHaveBeenCalled();
  });

  it('⭐ tick que EXPLODE não derruba o laço nem o acelera', async () => {
    // Banco fora do ar lançaria a cada iteração; o ritmo rápido transformaria a
    // indisponibilidade numa tempestade de tentativas.
    rodarTickDeFluxos.mockRejectedValue(new Error('banco fora'));
    const abort = new AbortController();
    const laco = runFlowEngineLoop({ intervalMs: 1, idleIntervalMs: 5 }, logger, abort.signal);
    await new Promise((r) => setTimeout(r, 20));
    abort.abort();
    await laco;

    expect(log.error).toHaveBeenCalled();
    expect(log.error.mock.calls[0]?.[0]).toMatch(/tick falhou/u);
  });

  it('⭐ motor que não monta DESLIGA o laço e avisa — nunca derruba o worker', async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error('env incompleto');
    });
    const abort = new AbortController();

    await runFlowEngineLoop(knobs, logger, abort.signal);

    expect(log.warn).toHaveBeenCalled();
    expect(log.warn.mock.calls[0]?.[0]).toMatch(/flow-engine loop OFF/u);
    expect(rodarTickDeFluxos).not.toHaveBeenCalled();
  });

  it('⭐ o sinal de abort encerra o laço', async () => {
    rodarTickDeFluxos.mockResolvedValue(vazio);
    const abort = new AbortController();
    const laco = runFlowEngineLoop({ intervalMs: 50, idleIntervalMs: 50 }, logger, abort.signal);
    await new Promise((r) => setTimeout(r, 5));
    abort.abort();
    // Sem o `addEventListener('abort')` do `esperar`, isto pendura por 50ms
    // extras a cada iteração e o desligamento do worker fica lento.
    await expect(laco).resolves.toBeUndefined();
  });
});
