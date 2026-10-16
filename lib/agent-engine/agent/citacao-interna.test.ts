/**
 * Citação interna da fonte — acúmulo no turno, a marca `sem_fonte` e a
 * gravação em TODA mensagem do agente. O UPDATE (com o número do trecho vindo
 * de `ai_chunks.position`) é SQL puro; aqui o banco é um dublê.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Citation } from '@/lib/ai/citations/types';

import type { Logger } from '../obs/logger';
import type { Queryable } from '../queue/queue';

import { acumularCitacoes, anexarCitacoes, semFonteNaMensagem } from './citacao-interna';
import { citationsFromHits } from './search-knowledge';

const MSG = '44444444-4444-4444-8444-444444444444';
const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const tabela: Citation = { chunk_id: 'c1', knowledge_source_id: 's1', source_name: 'Tabela de preços 2026', score: 0.8 };
const politica: Citation = { chunk_id: 'c2', knowledge_source_id: 's2', source_name: 'Política de troca', score: 0.7 };

describe('acumularCitacoes', () => {
  it('a segunda busca do turno SOMA às citações, em vez de apagar a primeira', () => {
    expect(acumularCitacoes([tabela], [politica]).map((c) => c.chunk_id)).toEqual(['c1', 'c2']);
  });

  it('o mesmo trecho achado duas vezes entra uma vez só', () => {
    expect(acumularCitacoes([tabela], [{ ...tabela, score: 0.9 }, politica])).toHaveLength(2);
  });
});

describe('semFonteNaMensagem', () => {
  it('afirmação factual sem trecho no turno ⇒ marcada (loja, clínica, imobiliária)', () => {
    expect(semFonteNaMensagem('A capinha custa R$ 49,90.', [])).toBe(true);
    expect(semFonteNaMensagem('Atendemos pelo convênio Unimed.', [])).toBe(true);
    expect(semFonteNaMensagem('O apartamento tem 2 vagas de garagem.', [])).toBe(true);
  });

  it('com trecho no turno, ou sem afirmação nenhuma, não marca', () => {
    expect(semFonteNaMensagem('A capinha custa R$ 49,90.', [tabela])).toBe(false);
    expect(semFonteNaMensagem('Oi! Como posso te ajudar?', [])).toBe(false);
    expect(semFonteNaMensagem('Qual modelo do seu celular?', [])).toBe(false);
  });
});

describe('anexarCitacoes', () => {
  it('grava ai_generated, sem_fonte e as citações — filtrando pela organização', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await anexarCitacoes({ query } as unknown as Queryable, { tenantId: 'org-1', messageId: MSG }, { body: 'Tem sim!', citacoes: [tabela] }, log);

    const [sql, valores] = query.mock.calls[0]!;
    expect(sql).toMatch(/'ai_generated', true/);
    expect(sql).toMatch(/'sem_fonte', \$4::boolean/);
    expect(sql).toMatch(/ch\.position \+ 1/);
    expect(sql).toMatch(/ch\.organization_id = \$1/);
    expect(sql).toMatch(/m\.organization_id = \$1/);
    expect(valores).toEqual(['org-1', MSG, JSON.stringify([tabela]), false]);
  });

  it('mensagem do agente sem busca também é gravada — vazia e, se factual, sem_fonte', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    await anexarCitacoes({ query } as unknown as Queryable, { tenantId: 'o', messageId: MSG }, { body: 'Entregamos em 2 dias.', citacoes: [] }, log);
    expect(query.mock.calls[0]![1]).toEqual(['o', MSG, '[]', true]);
  });

  it('id que não é de mensagem real (canal do ensaio) não toca no banco — erro ali abortaria a transação do ensaio', async () => {
    const query = vi.fn();
    await anexarCitacoes({ query } as unknown as Queryable, { tenantId: 'o', messageId: 'ensaio-job-1' }, { body: 'x', citacoes: [] }, log);
    expect(query).not.toHaveBeenCalled();
  });

  it('falha só loga — a mensagem já saiu', async () => {
    const warn = vi.fn();
    const query = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(
      anexarCitacoes({ query } as unknown as Queryable, { tenantId: 'o', messageId: MSG }, { body: 'x', citacoes: [] }, { ...log, warn }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});

describe('citationsFromHits leva nome e tipo do material no topo', () => {
  it('o painel lê source_name e source_type sem cavar em metadata', () => {
    const [c] = citationsFromHits([
      { chunk_id: 'c1', knowledge_source_id: 's1', content: 'x', similarity: 0.8, metadata: { source_type: 'documento' }, source_name: 'Tabela 2026' },
    ]);
    expect(c).toMatchObject({ source_name: 'Tabela 2026', source_type: 'documento' });
  });
});

/** Guarda de ligação conferida na fonte (mesmo molde de `gate-grounding-fiacao.test.ts`). */
describe('fiação no inbound-turn', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'inbound-turn.ts'), 'utf8');

  it('a busca ACUMULA as citações do turno', () => {
    expect(fonte).toMatch(/citacoesDoTurno = acumularCitacoes\(citacoesDoTurno, citationsFromHits\(out\.results\)\)/);
  });

  it('toda mensagem enviada (inclusive enfileirada) recebe as citações', () => {
    expect(fonte).toMatch(/outcome\.kind === 'sent' \|\| outcome\.kind === 'already_sent' \|\| outcome\.kind === 'queued'/);
    expect(fonte).toMatch(/anexarCitacoes\(pool, \{ tenantId, messageId: idDaMensagem \}, \{ body, citacoes: citacoesDoTurno \}, runLog\)/);
  });
});
