/**
 * Lacuna do acervo — a chave de dedupe, a guarda de PII e o aviso único por
 * lacuna. O SQL de upsert é provado contra Postgres real no `test:db`; aqui o
 * banco é um dublê que responde o que o upsert devolveria.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../obs/logger';
import type { Queryable } from '../queue/queue';

import { chaveDaPergunta, registrarLacuna, TETO_DA_PERGUNTA } from './lacuna-do-acervo';

const ORG = '11111111-1111-4111-8111-111111111111';
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe('chaveDaPergunta', () => {
  it('a mesma pergunta com acento, caixa e pontuação diferentes é a MESMA lacuna', () => {
    expect(chaveDaPergunta('Vocês têm na cor AZUL???')).toBe(chaveDaPergunta('voces tem na cor azul'));
    expect(chaveDaPergunta('Bom dia! Qual o horário de sábado?')).toBe(chaveDaPergunta('qual horario sabado'));
  });

  it('assuntos diferentes NÃO se juntam (palavra de conteúdo nunca é jogada fora)', () => {
    expect(chaveDaPergunta('tem entrega no sábado?')).not.toBe(chaveDaPergunta('tem troca no sábado?'));
    expect(chaveDaPergunta('o iPhone 14 serve?')).not.toBe(chaveDaPergunta('o iPhone 15 serve?'));
  });

  it('marcadores do anonimizador somem: nomes diferentes, mesma pergunta', () => {
    expect(chaveDaPergunta('[NOME] aqui, vocês fazem botox?')).toBe(chaveDaPergunta('vocês fazem botox?'));
  });

  it('conversa sem assunto não é lacuna', () => {
    expect(chaveDaPergunta('oi, tudo bem?')).toBe('');
    expect(chaveDaPergunta('???')).toBe('');
    expect(chaveDaPergunta('')).toBe('');
  });
});

function dublê(retornoDoUpsert: Record<string, unknown> | undefined, avisoAberto: boolean) {
  const chamadas: Array<{ sql: string; valores: unknown[] }> = [];
  const db: Queryable = {
    query: vi.fn(async (sql: string, valores: unknown[] = []) => {
      chamadas.push({ sql, valores });
      if (sql.includes('insert into knowledge_gaps')) return { rows: retornoDoUpsert ? [retornoDoUpsert] : [], rowCount: 1 };
      if (sql.includes('update agent_inbox_items')) return { rows: [], rowCount: avisoAberto ? 1 : 0 };
      if (sql.includes('insert into agent_inbox_items')) return { rows: [{ id: 'aviso-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Queryable['query'],
  };
  return { db, chamadas };
}

describe('registrarLacuna', () => {
  it('primeira ocorrência: grava a pergunta ANONIMIZADA e abre um aviso na Central', async () => {
    const { db, chamadas } = dublê({ id: 'gap-1', pergunta: 'x', ocorrencias: 1, status: 'aberta' }, false);

    const r = await registrarLacuna(db, ORG, 'Oi, sou a Maria, vocês têm a capinha do A54 em azul?', log);

    expect(r).toEqual({ registrada: true, lacunaId: 'gap-1', ocorrencias: 1 });
    const upsert = chamadas.find((c) => c.sql.includes('insert into knowledge_gaps'))!;
    expect(upsert.valores[0]).toBe(ORG);
    expect(String(upsert.valores[2])).not.toContain('Maria');
    expect(String(upsert.valores[2])).toContain('[NOME]');
    const insert = chamadas.find((c) => c.sql.includes('insert into agent_inbox_items'))!;
    expect(insert.valores).toContain('knowledge_gap');
    expect(insert.valores).toContain('gap-1');
  });

  it('repetida com aviso aberto: só atualiza o texto (o contador), sem segundo aviso', async () => {
    const { db, chamadas } = dublê({ id: 'gap-1', pergunta: 'tem em azul?', ocorrencias: 5, status: 'aberta' }, true);

    await registrarLacuna(db, ORG, 'tem em azul?', log);

    const update = chamadas.find((c) => c.sql.includes('update agent_inbox_items'))!;
    expect(String(update.valores[2])).toContain('(5 vezes)');
    expect(chamadas.some((c) => c.sql.includes('insert into agent_inbox_items'))).toBe(false);
  });

  it('descartada pelo dono: conta, mas não volta a avisar', async () => {
    const { db, chamadas } = dublê({ id: 'gap-1', pergunta: 'x', ocorrencias: 9, status: 'descartada' }, false);

    expect(await registrarLacuna(db, ORG, 'vocês vendem fiado?', log)).toEqual({ registrada: false, porque: 'descartada' });
    expect(chamadas.some((c) => c.sql.includes('agent_inbox_items'))).toBe(false);
  });

  it('conversa sem assunto não toca no banco', async () => {
    const { db } = dublê(undefined, false);
    expect(await registrarLacuna(db, ORG, 'oi, bom dia!', log)).toEqual({ registrada: false, porque: 'sem_pergunta' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('o exemplo guardado tem teto', async () => {
    const { db, chamadas } = dublê({ id: 'g', pergunta: 'x', ocorrencias: 1, status: 'aberta' }, false);
    await registrarLacuna(db, ORG, `vocês fazem ${'implante dentário '.repeat(60)}?`, log);
    const upsert = chamadas.find((c) => c.sql.includes('insert into knowledge_gaps'))!;
    expect(String(upsert.valores[2]).length).toBeLessThanOrEqual(TETO_DA_PERGUNTA);
  });

  it('nunca lança: erro de banco vira desfecho, e o log não leva a pergunta', async () => {
    const warn = vi.fn();
    const db: Queryable = { query: vi.fn().mockRejectedValue(new Error('conexão caiu')) as unknown as Queryable['query'] };

    const r = await registrarLacuna(db, ORG, 'qual o preço do clareamento?', { ...log, warn });

    expect(r).toEqual({ registrada: false, porque: 'erro' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('clareamento');
  });
});
