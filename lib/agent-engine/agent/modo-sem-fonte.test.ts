import { describe, expect, it } from 'vitest';

import { mesclarAjustesDeFonte, orgAiSettingsSchema, salvarAjustesDeFonteSchema } from '@/lib/schemas/settings';

import {
  INSTRUCAO_BUSQUE_ANTES,
  INSTRUCAO_FAIXA_CINZA,
  instrucaoBuscaIndisponivel,
  instrucaoSemFonte,
} from './instrucao-sem-fonte';
import { lerAjustesDeFonte, resolverModoSemFonte } from './modo-sem-fonte';

describe('resolverModoSemFonte', () => {
  it('a escolha da organização vence a equipe configurada', () => {
    expect(resolverModoSemFonte({ escolhaDaOrg: 'so_agente', equipeConfigurada: 4, handoffDisponivel: true })).toEqual({
      modo: 'so_agente',
      origem: 'escolha',
    });
    expect(resolverModoSemFonte({ escolhaDaOrg: 'equipe', equipeConfigurada: 0, handoffDisponivel: true }).modo).toBe(
      'equipe',
    );
  });

  it('sem escolha, decide a equipe configurada', () => {
    expect(resolverModoSemFonte({ escolhaDaOrg: undefined, equipeConfigurada: 2, handoffDisponivel: true })).toEqual({
      modo: 'equipe',
      origem: 'equipe_configurada',
    });
    // Instalação fresca: o dono é admin mas não cadastrou disponibilidade —
    // passar a conversa para ele seria passar para o vazio.
    expect(resolverModoSemFonte({ escolhaDaOrg: undefined, equipeConfigurada: 0, handoffDisponivel: true })).toEqual({
      modo: 'so_agente',
      origem: 'sem_equipe',
    });
  });

  it('sem a ferramenta de passagem, `equipe` é impossível — mesmo escolhido', () => {
    expect(resolverModoSemFonte({ escolhaDaOrg: 'equipe', equipeConfigurada: 5, handoffDisponivel: false })).toEqual({
      modo: 'so_agente',
      origem: 'sem_ferramenta_de_passagem',
    });
  });
});

describe('lerAjustesDeFonte', () => {
  const db = (rows: unknown[]) => ({ query: async () => ({ rows }) }) as never;

  it('lê escolha, equipe, conferência e faixa cinza', async () => {
    const r = await lerAjustesDeFonte(
      db([{ ai: { fallback_sem_fonte: 'equipe', grounding_gate: false, faixa_cinza: 0.1 }, equipe: '3' }]),
      'org',
    );
    expect(r).toEqual({ escolha: 'equipe', equipeConfigurada: 3, conferenciaLigada: false, faixaCinza: 0.1 });
  });

  it('jsonb ausente ou lixo cai no padrão: sem escolha, conferência LIGADA', async () => {
    const r = await lerAjustesDeFonte(db([{ ai: { fallback_sem_fonte: 'qualquer', grounding_gate: 'sim' }, equipe: 0 }]), 'org');
    expect(r).toEqual({ escolha: undefined, equipeConfigurada: 0, conferenciaLigada: true, faixaCinza: 0.15 });
  });

  it('falha de leitura não derruba o turno — e erra para não prometer ninguém', async () => {
    const quebrado = { query: async () => { throw new Error('coluna não existe'); } } as never;
    const r = await lerAjustesDeFonte(quebrado, 'org');
    expect(r.escolha).toBeUndefined();
    expect(r.equipeConfigurada).toBe(0);
    expect(r.conferenciaLigada).toBe(true);
  });
});

describe('instruções sem fonte', () => {
  // As três frases que a medição de 2026-10-15 achou convidando a inventar.
  const PROIBIDO = [/o que (voc[êe] )?j[áa] sabe/i, /siga sem/i, /vou confirmar/i];

  it.each(['equipe', 'so_agente'] as const)('modo %s nunca convida a inventar nem promete confirmar', (modo) => {
    for (const texto of [instrucaoSemFonte(modo), instrucaoBuscaIndisponivel(modo)]) {
      for (const re of PROIBIDO) expect(texto).not.toMatch(re);
      expect(texto).toMatch(/não afirme/i);
    }
  });

  it('equipe manda chamar a passagem; só-agente NÃO promete retorno', () => {
    expect(instrucaoSemFonte('equipe')).toContain('request_human_handoff');
    const so = instrucaoSemFonte('so_agente');
    expect(so).not.toContain('request_human_handoff');
    expect(so).toMatch(/sem prometer retorno/);
  });

  it('faixa cinza e busque-antes dizem o que fazer', () => {
    expect(INSTRUCAO_FAIXA_CINZA).toMatch(/parecido não serve/);
    expect(INSTRUCAO_BUSQUE_ANTES).toContain('search_knowledge');
  });
});

describe('settings.ai', () => {
  it('a escrita é ESTRITA: modo fora da lista é recusado, não normalizado', () => {
    expect(salvarAjustesDeFonteSchema.safeParse({ fallback_sem_fonte: 'chefe' }).success).toBe(false);
    expect(salvarAjustesDeFonteSchema.safeParse({ campo_extra: 1 }).success).toBe(false);
  });

  it('a leitura é DEFENSIVA: lixo vira ausência', () => {
    expect(orgAiSettingsSchema.parse('não é objeto')).toEqual({});
    expect(orgAiSettingsSchema.parse({ faixa_cinza: 9 }).faixa_cinza).toBeUndefined();
  });

  it('merge: ausente não mexa; null volta a decidir pela equipe; o resto sobrevive', () => {
    const atual = { fallback_sem_fonte: 'equipe', grounding_gate: false, outra: 1 };
    expect(mesclarAjustesDeFonte(atual, { fallback_sem_fonte: 'so_agente' })).toEqual({
      fallback_sem_fonte: 'so_agente',
      grounding_gate: false,
      outra: 1,
    });
    // Cliente que só manda o modo NÃO religa a conferência por acidente.
    expect(mesclarAjustesDeFonte(atual, {}).grounding_gate).toBe(false);
    const semEscolha = mesclarAjustesDeFonte(atual, { fallback_sem_fonte: null });
    expect('fallback_sem_fonte' in semEscolha).toBe(false);
    expect(mesclarAjustesDeFonte(null, { grounding_gate: true })).toEqual({ grounding_gate: true });
  });
});
