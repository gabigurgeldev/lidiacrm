import { describe, expect, it } from 'vitest';

import { buscarNotasDoLead, CANDIDATOS_DE_NOTA, NOTAS_DEVOLVIDAS } from './notas-do-lead-busca';

const NOTAS = [
  { id: 'n1', headline: 'Pedido 123 atrasou', body: 'reclamou do atraso' },
  { id: 'n2', headline: 'Usa tamanho M', body: 'prefere vestido longo' },
  { id: 'n3', headline: 'Mora em Curitiba', body: 'frete sul' },
];

function dbFalso(linhas = NOTAS) {
  const chamadas: Array<{ sql: string; params: unknown[] }> = [];
  return {
    chamadas,
    db: {
      query: async (sql: string, params: unknown[]) => {
        chamadas.push({ sql, params });
        return { rows: linhas, rowCount: linhas.length };
      },
    } as never,
  };
}

describe('buscarNotasDoLead', () => {
  it('escopa por org e contato do runtime e limita os candidatos', async () => {
    const { db, chamadas } = dbFalso();
    await buscarNotasDoLead(db, { tenantId: 'org-1', leadId: 'c-1' }, 'tamanho', {
      rerank: { resolverChave: async () => null },
    });
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.sql).toMatch(/where organization_id = \$1 and contact_id = \$2/);
    expect(chamadas[0]?.params).toEqual(['org-1', 'c-1', 'tamanho', CANDIDATOS_DE_NOTA]);
  });

  it('sem chave de rerank, mantém a ordem do banco e não inventa relevância', async () => {
    const { db } = dbFalso();
    const r = await buscarNotasDoLead(db, { tenantId: 'org-1', leadId: 'c-1' }, 'tamanho', {
      rerank: { resolverChave: async () => null },
    });
    expect(r.reordenado).toBe(false);
    expect(r.notas.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
    expect(r.notas.every((n) => n.relevancia === null)).toBe(true);
  });

  it('com rerank, devolve a ordem dele com o corpo', async () => {
    const { db } = dbFalso();
    const r = await buscarNotasDoLead(db, { tenantId: 'org-1', leadId: 'c-1' }, 'que tamanho ela veste', {
      rerank: {
        resolverChave: async () => ({ apiKey: 'k', origem: 'chave_openrouter_da_instalacao' }),
        fetchImpl: (async () =>
          new Response(JSON.stringify({ results: [{ index: 1, relevance_score: 0.92 }, { index: 0, relevance_score: 0.1 }] }), {
            status: 200,
          })) as typeof fetch,
        registrar: () => {},
      },
    });
    expect(r.reordenado).toBe(true);
    expect(r.notas[0]).toEqual({ id: 'n2', headline: 'Usa tamanho M', body: 'prefere vestido longo', relevancia: 0.92 });
  });

  it('lead sem nota não chama o rerank', async () => {
    const { db } = dbFalso([]);
    let chamou = false;
    const r = await buscarNotasDoLead(db, { tenantId: 'org-1', leadId: 'c-1' }, 'x y', {
      rerank: {
        resolverChave: async () => {
          chamou = true;
          return null;
        },
      },
    });
    expect(r).toEqual({ notas: [], reordenado: false });
    expect(chamou).toBe(false);
  });

  it('devolve no máximo NOTAS_DEVOLVIDAS', async () => {
    const muitas = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, headline: `h${i}`, body: 'b' }));
    const { db } = dbFalso(muitas);
    const r = await buscarNotasDoLead(db, { tenantId: 'org-1', leadId: 'c-1' }, 'h', {
      rerank: { resolverChave: async () => null },
    });
    expect(r.notas).toHaveLength(NOTAS_DEVOLVIDAS);
  });
});
