import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { casoAguardandoHumano } from './human-cases';

function dbQue(open: boolean) {
  return { query: vi.fn().mockResolvedValue({ rows: [{ open }], rowCount: 1 }) };
}

describe('casoAguardandoHumano', () => {
  it('true quando a conversa tem caso esperando a equipe', async () => {
    const db = dbQue(true);
    await expect(casoAguardandoHumano(db as never, 'org-1', 'conv-1')).resolves.toBe(true);
  });

  it('false sem caso — o follow-up segue normal', async () => {
    await expect(casoAguardandoHumano(dbQue(false) as never, 'org-1', 'conv-1')).resolves.toBe(false);
  });

  it('filtra por organização E conversa, e só olha awaiting_human (awaiting_lead libera o follow-up)', async () => {
    const db = dbQue(false);
    await casoAguardandoHumano(db as never, 'org-1', 'conv-1');
    const [sql, params] = db.query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(['org-1', 'conv-1']);
    expect(sql).toContain('organization_id = $1');
    expect(sql).toContain('conversation_id = $2');
    expect(sql).toContain("status = 'awaiting_human'");
    expect(sql).not.toContain('awaiting_lead');
  });

  it('false se a leitura não devolve linha', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await expect(casoAguardandoHumano(db as never, 'org-1', 'conv-1')).resolves.toBe(false);
  });
});

describe('a trava está ligada no turno do agente', () => {
  // Sem este teste, apagar o `if` do inbound-turn deixa a função verde e o spam de volta.
  const fonte = readFileSync(join(__dirname, 'inbound-turn.ts'), 'utf-8');

  it("followup_turn consulta casoAguardandoHumano e retorna antes de falar", () => {
    const i = fonte.indexOf("job.kind === 'followup_turn' && (await casoAguardandoHumano(");
    expect(i).toBeGreaterThan(-1);
    const bloco = fonte.slice(i, i + 400);
    expect(bloco).toMatch(/return;/);
  });

  it('a trava vem DEPOIS do handoff humano', () => {
    const handoff = fonte.indexOf('turno pulado — lead em handoff humano');
    const trava = fonte.indexOf('follow-up pulado — caso aberto aguardando a equipe');
    expect(handoff).toBeGreaterThan(-1);
    expect(trava).toBeGreaterThan(handoff);
  });
});
