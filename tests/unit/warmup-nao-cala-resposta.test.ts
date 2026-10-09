/**
 * O warm-up não cala resposta a quem acabou de escrever.
 *
 * Produção, 2026-10-08 (Açaí Delícia): número conectado na véspera — idade 1 dia,
 * cap de warm-up 20/dia. No 3º atendimento do dia, no meio do pedido, todo envio da
 * IA voltou `pacing/warmup_cap`; o cliente perguntou "Tem farinha tapioca?" e nunca
 * teve resposta, e ninguém foi avisado. Warm-up existe contra volume para quem não
 * pediu contato — responder a quem escreveu é o oposto.
 *
 * Os dois lados são medidos: resposta passa; contato que NÃO escreveu nas últimas
 * 24 h (prospecção fria, reengajamento) segue barrado; e o limite diário do CRM
 * continua valendo para resposta também.
 */
import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { pacingGate, runBeforeSend, type GateContext } from '@/lib/agent-engine/guardrails/before-send';
import type { Logger } from '@/lib/agent-engine/obs/logger';
import { PACING_DEFAULTS } from '@/lib/agent-engine/pacing/defaults';
import { decidePacing } from '@/lib/agent-engine/pacing/engine';
import { SPINNING_DEFAULTS } from '@/lib/agent-engine/spinning/defaults';

const AGORA = new Date('2026-10-08T23:17:28Z'); // 20h17 BRT, quinta — dentro da janela
const NUMERO_DE_ONTEM = new Date('2026-10-07T13:33:30Z');
const ESTOURADO = { lastSentAt: null, sentToday: 20, numberActivatedAt: NUMERO_DE_ONTEM };

function ctx(lastInboundAt: Date | null, crmDailyLimit: number | null = null): GateContext {
  return {
    now: AGORA,
    body: 'Temos sim!',
    optedOut: false,
    provider: 'waha',
    messagingWindow: { lastInboundAt },
    pacing: { knobs: PACING_DEFAULTS, state: ESTOURADO, crmDailyLimit, rng: () => 0 },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: 'inject' },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
  };
}

describe('warm-up × resposta a quem escreveu', () => {
  it('o motor, sem o campo, segue vetando por warm-up (comportamento anterior)', () => {
    const d = decidePacing({ now: AGORA, knobs: PACING_DEFAULTS, state: ESTOURADO, crmDailyLimit: null, rng: () => 0 });
    expect(d.allow).toBe(false);
    if (d.allow) throw new Error('inalcançável');
    expect(d.code).toBe('warmup_cap');
  });

  it('cliente que escreveu há segundos recebe resposta mesmo com o warm-up estourado', () => {
    const v = pacingGate.evaluate(ctx(new Date('2026-10-08T23:17:04Z')));
    expect(v.pass).toBe(true);
  });

  it('contato que não escreveu nas últimas 24 h continua barrado pelo warm-up', () => {
    const anteontem = pacingGate.evaluate(ctx(new Date('2026-10-07T20:00:00Z')));
    expect(anteontem.pass).toBe(false);
    if (anteontem.pass) throw new Error('inalcançável');
    expect(anteontem.code).toBe('warmup_cap');

    const nunca = pacingGate.evaluate(ctx(null));
    expect(nunca.pass).toBe(false);
  });

  it('o limite diário do CRM vale para resposta também', () => {
    const v = pacingGate.evaluate(ctx(new Date('2026-10-08T23:17:04Z'), 20));
    expect(v.pass).toBe(false);
    if (v.pass) throw new Error('inalcançável');
    expect(v.code).toBe('daily_cap');
  });
});

/**
 * O outro lado do mesmo incidente: quando o cap barra MESMO (prospecção, ou o
 * limite diário do CRM), a IA para de enviar por aquele número até amanhã — e
 * isso precisa aparecer na Central. Antes, o veto morria no trace.
 */
describe('cap do número que barra a IA abre aviso na Central', () => {
  async function roda(sentToday: string, crmDailyLimit: number | null, lastInboundAt: Date | null) {
    const client = {
      query: vi.fn(async (sql: string) => {
        const q = String(sql);
        if (q.includes('from channel_sessions')) return { rows: [{ provider: 'waha' }] };
        if (q.includes('from pacing_ledger')) return { rows: [{ last_sent_at: null, sent_today: sentToday }] };
        if (q.includes('last_inbound_at')) return { rows: lastInboundAt ? [{ last_inbound_at: lastInboundAt }] : [] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn().mockResolvedValue(client), query: vi.fn().mockResolvedValue({ rows: [] }) };
    const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const r = await runBeforeSend({
      pool: pool as unknown as pg.Pool,
      log,
      tenantId: '00000000-0000-4000-8000-000000000001',
      leadId: '00000000-0000-4000-8000-000000000002',
      jobId: '00000000-0000-4000-8000-000000000003',
      channelSessionId: '00000000-0000-4000-8000-000000000004',
      body: 'oi',
      optedOutThisTurn: false,
      crmDailyLimit,
      now: AGORA,
      rng: () => 0,
      sleep: async () => {},
      gates: [pacingGate],
      send: async () => ({ kind: 'sent', idempotencyKey: 'k', messageId: 'm' }),
    });
    const avisos = pool.query.mock.calls.filter(([sql]) => String(sql).includes("'pacing_cap'"));
    return { r, avisos };
  }

  it('limite diário estourado: veta e abre UM aviso, com dedup pelo número', async () => {
    const { r, avisos } = await roda('500', 500, new Date('2026-10-08T23:17:04Z'));
    expect(r.status).toBe('vetoed');
    expect(avisos).toHaveLength(1);
    expect(String(avisos[0]![0])).toMatch(/where not exists/);
    expect(avisos[0]![1]).toContain('00000000-0000-4000-8000-000000000004');
  });

  it('envio que passa não abre aviso nenhum', async () => {
    const { r, avisos } = await roda('3', 500, new Date('2026-10-08T23:17:04Z'));
    expect(r.status).toBe('sent');
    expect(avisos).toHaveLength(0);
  });
});
