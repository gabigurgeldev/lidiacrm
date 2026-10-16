/**
 * Materiais "de todos" (0245) somados aos do agente — e a fiação no turno.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Queryable } from '../queue/queue';

import { lerFontesDeTodosOsAgentes, materiaisDoTurno } from './fontes-da-organizacao';

describe('materiaisDoTurno', () => {
  it('soma o material ensinado aos do agente, sem repetir', () => {
    expect(materiaisDoTurno({ doAgente: ['a', 'b'], deTodos: ['b', 'ens'], temIndiceLegado: false })).toEqual(['a', 'b', 'ens']);
  });

  it('agente sem material nenhum passa a ter o ensinado (a busca entra no turno)', () => {
    expect(materiaisDoTurno({ doAgente: [], deTodos: ['ens'], temIndiceLegado: false })).toEqual(['ens']);
  });

  it('caminho LEGADO intocado: somar uma fonte trocaria o índice antigo pela busca por materiais', () => {
    expect(materiaisDoTurno({ doAgente: [], deTodos: ['ens'], temIndiceLegado: true })).toEqual([]);
  });
});

describe('lerFontesDeTodosOsAgentes', () => {
  it('filtra pela organização e só material ativo e pronto', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 'ens' }] });
    expect(await lerFontesDeTodosOsAgentes({ query } as unknown as Queryable, 'org-1')).toEqual(['ens']);
    const [sql, valores] = query.mock.calls[0]!;
    expect(sql).toMatch(/organization_id = \$1/);
    expect(sql).toMatch(/todos_os_agentes/);
    expect(sql).toMatch(/is_active/);
    expect(valores).toEqual(['org-1']);
  });

  it('banco sem a coluna (clone desatualizado) devolve vazio em vez de derrubar o turno', async () => {
    const query = vi.fn().mockRejectedValue(new Error('column "todos_os_agentes" does not exist'));
    expect(await lerFontesDeTodosOsAgentes({ query } as unknown as Queryable, 'org-1')).toEqual([]);
  });
});

/**
 * Guarda de LIGAÇÃO, conferida na fonte (não há seam leve para `runAgentTurn`,
 * mesmo motivo de `gate-grounding-fiacao.test.ts`): a busca e a presença da
 * ferramenta usam a lista SOMADA, e a lacuna é registrada no fim do turno.
 */
describe('fiação no inbound-turn', () => {
  const fonte = fs.readFileSync(path.join(__dirname, 'inbound-turn.ts'), 'utf8');

  it('a busca recebe a lista somada', () => {
    expect(fonte).toMatch(/knowledgeSourceIds: materiais,/);
    expect(fonte).not.toMatch(/knowledgeSourceIds: agentConfig\?\.knowledgeSourceIds/);
  });

  it('a ferramenta de busca fica no turno quando só há material ensinado', () => {
    expect(fonte).toMatch(/if \(materiais\.length === 0 && agentConfig\?\.activeKbVersionId == null\)/);
  });

  it('turno sem fonte registra a lacuna — fora do ensaio e do opt-out', () => {
    expect(fonte).toMatch(
      /\(semFonteNoTurno\(\) \|\| vetosDeFonte > 0\) && !optedOutThisTurn && deps\.ensaio === undefined[\s\S]{0,120}registrarLacuna\(pool, tenantId, skillSignal, runLog\)/,
    );
  });
});
