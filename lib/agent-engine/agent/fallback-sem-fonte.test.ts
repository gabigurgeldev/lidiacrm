import { randomUUID } from 'node:crypto';

import { tool, type ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { rotuloDoMotivo, MOTIVO_FORA_DA_BASE } from '@/lib/escalacao/motivos';
import { decideSpinning, hashNormalized, normalizeCopy } from '../spinning/engine';
import { SPINNING_DEFAULTS } from '../spinning/defaults';
import { detectarAfirmacaoFactual } from '../guardrails/grounding';

import { SEQ_DO_AVISO_SEM_FONTE, textoSemFonte, VARIANTES_SEM_FONTE } from './aviso-sem-fonte';
import { SEQ_DO_AVISO } from './aviso-de-escalacao';
import { decidirFallbackSemFonte, MAX_VETOS_DE_FONTE } from './fallback-sem-fonte';
import { FERRAMENTAS_QUE_NAO_SAO_FONTE, registrarResultados } from './fontes-do-turno';

const base = {
  vetosDeFonte: 1,
  passouNoTurno: false,
  falouDepoisDoVeto: false,
  clienteBloqueado: false,
} as const;

describe('decidirFallbackSemFonte', () => {
  it('sem veto de fonte, o runtime não faz nada', () => {
    expect(decidirFallbackSemFonte({ ...base, modo: 'equipe', vetosDeFonte: 0 })).toBe('nada');
    expect(decidirFallbackSemFonte({ ...base, modo: 'so_agente', vetosDeFonte: 0 })).toBe('nada');
  });

  it('equipe: vetou e ninguém passou ⇒ o runtime passa — mesmo que o modelo tenha dito "não sei"', () => {
    expect(decidirFallbackSemFonte({ ...base, modo: 'equipe' })).toBe('passar_para_equipe');
    expect(decidirFallbackSemFonte({ ...base, modo: 'equipe', falouDepoisDoVeto: true })).toBe('passar_para_equipe');
  });

  it('o modelo passou a conversa: nada a fazer', () => {
    expect(decidirFallbackSemFonte({ ...base, modo: 'equipe', passouNoTurno: true })).toBe('nada');
  });

  it('só-agente: fala só se o modelo calou depois do veto, ou se insistiu até o teto', () => {
    expect(decidirFallbackSemFonte({ ...base, modo: 'so_agente' })).toBe('dizer_que_nao_sabe');
    expect(decidirFallbackSemFonte({ ...base, modo: 'so_agente', falouDepoisDoVeto: true })).toBe('nada');
    expect(
      decidirFallbackSemFonte({ ...base, modo: 'so_agente', falouDepoisDoVeto: true, vetosDeFonte: MAX_VETOS_DE_FONTE }),
    ).toBe('dizer_que_nao_sabe');
  });

  it('cliente bloqueado (opt-out): nada sai e ninguém é chamado', () => {
    expect(decidirFallbackSemFonte({ ...base, modo: 'equipe', clienteBloqueado: true })).toBe('nada');
    expect(decidirFallbackSemFonte({ ...base, modo: 'so_agente', clienteBloqueado: true })).toBe('nada');
  });
});

describe('a mensagem de "não tenho essa informação"', () => {
  it('não afirma nada da empresa e não promete retorno', () => {
    for (const v of VARIANTES_SEM_FONTE) {
      expect(detectarAfirmacaoFactual(v), v).toEqual([]);
      expect(v).not.toMatch(/retorn|alguém (vai|já)|equipe|em breve|vou confirmar/i);
    }
  });

  it('o mesmo lead lê sempre a mesma; leads diferentes leem as três', () => {
    const lead = randomUUID();
    expect(textoSemFonte(lead)).toBe(textoSemFonte(lead));
    const vistas = new Set(Array.from({ length: 60 }, () => textoSemFonte(randomUUID())));
    expect(vistas.size).toBe(VARIANTES_SEM_FONTE.length);
  });

  it('as variantes são diferentes de verdade para o gate de repetição', () => {
    // A função REAL do gate: cada variante entra na janela e a próxima não pode
    // ser tomada por cópia dela.
    const janela: Array<{ normalizedText: string; normalizedHash: string }> = [];
    for (const v of VARIANTES_SEM_FONTE) {
      expect(decideSpinning({ candidate: v, window: janela, knobs: SPINNING_DEFAULTS }).allow, v).toBe(true);
      const n = normalizeCopy(v);
      janela.unshift({ normalizedText: n, normalizedHash: hashNormalized(n) });
    }
  });

  it('seq próprio, fora do turno (1..n) e do aviso de escalação (0)', () => {
    expect(SEQ_DO_AVISO_SEM_FONTE).not.toBe(SEQ_DO_AVISO);
    expect(SEQ_DO_AVISO_SEM_FONTE).toBeGreaterThan(20);
  });
});

describe('registrarResultados', () => {
  const fazer = (nome: string, saida: unknown) =>
    tool({ description: nome, inputSchema: z.object({}), execute: async () => saida });

  it('o resultado das ferramentas de consulta vira fonte; o modelo recebe o mesmo valor', async () => {
    const vistos: string[] = [];
    const tools: ToolSet = registrarResultados(
      { consultar_catalogo: fazer('consultar_catalogo', { produto: 'Capinha', compativel: ['iPhone 14'] }) },
      (t) => vistos.push(t),
    );
    const saida = await tools.consultar_catalogo!.execute!({}, { toolCallId: '1', messages: [], context: undefined });
    expect(saida).toEqual({ produto: 'Capinha', compativel: ['iPhone 14'] });
    expect(vistos).toEqual([JSON.stringify({ produto: 'Capinha', compativel: ['iPhone 14'] })]);
  });

  it('as de falar, passar, buscar e reler o contexto NÃO são fonte', async () => {
    const vistos: string[] = [];
    const nomes = [...FERRAMENTAS_QUE_NAO_SAO_FONTE];
    const tools = registrarResultados(
      Object.fromEntries(nomes.map((n) => [n, fazer(n, { ok: true, cliente_disse: 'tem azul' })])),
      (t) => vistos.push(t),
    );
    for (const n of nomes) await tools[n]!.execute!({}, { toolCallId: n, messages: [], context: undefined });
    expect(vistos).toEqual([]);
    expect(nomes).toContain('get_lead_context');
  });
});

describe('motivo fora_da_base', () => {
  it('a tela lê uma frase, não o código', () => {
    expect(rotuloDoMotivo(MOTIVO_FORA_DA_BASE)).toBe('Faltou informação no material do agente');
    // Motivo livre de quem escalou passa como veio.
    expect(rotuloDoMotivo('cliente quer desconto especial')).toBe('cliente quer desconto especial');
  });
});
