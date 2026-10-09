/**
 * Checkpoint malformado NÃO reabre um turno que já respondeu.
 *
 * Produção, 2026-10-08 (Açaí Delícia, gemini-2.5-flash-lite): o fechamento do
 * turno devolveu JSON inválido, `parseCheckpointText` lançou, e o throw subiu
 * até o `failJob` — de um job cuja resposta JÁ tinha saído para o cliente. A fila
 * o re-rodou de 10 em 10 minutos até a 5ª tentativa: cada re-run pode mandar a
 * resposta de novo, e a fila serial do contato segurou a mensagem seguinte dele.
 *
 * `runAgentTurn` não é alcançável por unidade (precisa do turno inteiro — ver o
 * cabeçalho de `handoff-por-orcamento.test.ts`), então a propriedade é medida onde
 * ela mora, no texto, com controle negativo.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseCheckpointText } from '@/lib/agent-engine/agent/inbound-turn';

const FONTE = readFileSync(join(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'), 'utf8');

/** A chamada de `parseCheckpointText(closing...)` está dentro de um `try {` que a precede de perto? */
function chamadaEstaProtegida(fonte: string): boolean {
  const i = fonte.indexOf('parseCheckpointText(closing.result.text)');
  if (i === -1) throw new Error('chamada não encontrada — o detector não mede nada');
  const antes = fonte.slice(Math.max(0, i - 200), i);
  const depois = fonte.slice(i, i + 400);
  return /try\s*\{\s*(content\s*=\s*)?$/.test(antes.trimEnd() + ' ') || (/try\s*\{[^}]*$/.test(antes) && /catch\s*\(/.test(depois));
}

describe('checkpoint malformado', () => {
  it('o parser continua recusando JSON inválido (o contrato dele não muda)', () => {
    expect(() => parseCheckpointText('{"commitments": [,]}')).toThrow(/checkpoint inválido/);
  });

  it('o call site em runAgentTurn engole a falha do parser, com log', () => {
    expect(chamadaEstaProtegida(FONTE)).toBe(true);
    expect(FONTE).toContain('checkpoint do turno veio malformado — a resposta já saiu, o job segue');
  });

  it('controle negativo: o detector acusa a chamada fora do try', () => {
    const semTry = FONTE.replace(
      /try \{\s*content = parseCheckpointText\(closing\.result\.text\);\s*\} catch \(err\) \{[^}]*\}/,
      'content = parseCheckpointText(closing.result.text);',
    );
    expect(semTry).not.toBe(FONTE);
    expect(chamadaEstaProtegida(semTry)).toBe(false);
  });
});
