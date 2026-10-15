import { describe, expect, it, vi } from 'vitest';
import { loadSkills } from './skills';

type Linha = {
  organization_id: string | null;
  id: string;
  name: string;
  nichos?: string[] | null;
};

function banco(linhas: Linha[]) {
  const rows = linhas.map((l) => ({
    description: 'd',
    body: 'b',
    matcher: { any_keywords: [l.name] },
    manifest: [],
    nichos: [],
    ...l,
  }));
  return { query: vi.fn().mockResolvedValue({ rows }) } as never;
}

const nomes = (skills: Array<{ name: string }>) => skills.map((s) => s.name);

describe('loadSkills', () => {
  it('loadSkills expõe versionId de cada skill', async () => {
    const db = banco([{ organization_id: null, id: 'ver-1', name: 'frete' }]);
    const skills = await loadSkills(db, 'org1');
    expect(skills[0]?.versionId).toBe('ver-1');
  });

  // Catálogo usado pelos casos abaixo: duas universais da plataforma, duas de
  // nicho da plataforma, uma importada pela org e um fork da org de uma universal.
  const catalogo: Linha[] = [
    { organization_id: null, id: 'p-objecao', name: 'objecao-preco', nichos: [] },
    { organization_id: null, id: 'p-insatisfeito', name: 'cliente-insatisfeito', nichos: [] },
    { organization_id: null, id: 'p-rastreio', name: 'loja-rastreio-de-pedido', nichos: ['loja'] },
    { organization_id: null, id: 'p-urgencia', name: 'clinica-sinais-de-urgencia', nichos: ['clinica'] },
    // importada por .zip: nasce com nichos vazio e NÃO é universal
    { organization_id: 'org1', id: 'o-propria', name: 'politica-da-casa', nichos: [] },
    // fork da universal: continua universal, com a versão da org
    { organization_id: 'org1', id: 'o-objecao', name: 'objecao-preco', nichos: [] },
  ];

  it('padrão (null): universais + as da organização, sem as de nicho', async () => {
    const skills = await loadSkills(banco(catalogo), 'org1', { skillNames: null });
    expect(nomes(skills)).toEqual(['cliente-insatisfeito', 'objecao-preco', 'politica-da-casa']);
  });

  it('sem opções = padrão: quem chamava antes da 0241 não muda de comportamento por acidente', async () => {
    const skills = await loadSkills(banco(catalogo), 'org1');
    expect(nomes(skills)).toEqual(['cliente-insatisfeito', 'objecao-preco', 'politica-da-casa']);
  });

  it('lista: universais + exatamente os nomes listados', async () => {
    const skills = await loadSkills(banco(catalogo), 'org1', { skillNames: ['loja-rastreio-de-pedido'] });
    expect(nomes(skills)).toEqual(['cliente-insatisfeito', 'loja-rastreio-de-pedido', 'objecao-preco']);
  });

  it('lista vazia desliga as opcionais, nunca as universais', async () => {
    const skills = await loadSkills(banco(catalogo), 'org1', { skillNames: [] });
    expect(nomes(skills)).toEqual(['cliente-insatisfeito', 'objecao-preco']);
  });

  it('o fork da organização de uma universal fica sempre ligado, com a versão da organização', async () => {
    const skills = await loadSkills(banco(catalogo), 'org1', { skillNames: [] });
    expect(skills.find((s) => s.name === 'objecao-preco')?.versionId).toBe('o-objecao');
  });

  it('nome listado que não existe mais é ignorado, sem erro', async () => {
    const skills = await loadSkills(banco(catalogo), 'org1', { skillNames: ['skill-que-saiu', 'politica-da-casa'] });
    expect(nomes(skills)).toEqual(['cliente-insatisfeito', 'objecao-preco', 'politica-da-casa']);
  });

  it('banco sem a coluna nichos (null) trata a skill de plataforma como universal', async () => {
    const skills = await loadSkills(banco([{ organization_id: null, id: 'p-x', name: 'agendamento', nichos: null }]), 'org1', {
      skillNames: [],
    });
    expect(nomes(skills)).toEqual(['agendamento']);
  });
});
