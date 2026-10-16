import { describe, expect, it } from 'vitest';

import { canonizarNumero, decidirFundamentacao, detectarAfirmacaoFactual, type ContextoDeFundamentacao } from './grounding';

/**
 * Frases reais de nicho, dos DOIS lados. Veto falso empurra a conversa para a
 * passagem sem motivo; veto ausente deixa a invenção sair. As duas listas
 * crescem juntas.
 */
const INSTRUCOES_CLINICA =
  'Você é a Ana, assistente da Clínica Sorriso. Atendemos de segunda a sexta, das 8h às 18h. ' +
  'A consulta de avaliação custa R$ 150,00.';

function ctx(p: Partial<ContextoDeFundamentacao> = {}): ContextoDeFundamentacao {
  const fontes = p.fontes ?? INSTRUCOES_CLINICA;
  return {
    modo: 'equipe',
    buscaDisponivel: true,
    buscasFeitas: 0,
    buscasComFonte: 0,
    ...p,
    fontes,
    fontesDeNumeros: p.fontesDeNumeros ?? fontes,
  };
}

const vetada = (body: string, c: ContextoDeFundamentacao) => !decidirFundamentacao(body, c).pass;

describe('fundamentação — VETA a afirmação sem fonte', () => {
  it('clínica: preço e número de sessões inventados, sem buscar', () => {
    const d = decidirFundamentacao('O clareamento custa R$ 450 e é feito em 2 sessões.', ctx());
    expect(d.pass).toBe(false);
    if (!d.pass) {
      expect(d.categorias).toContain('preco');
      expect(d.semBusca).toBe(true);
      // Havia material e ninguém buscou: a instrução é BUSCAR, não passar.
      expect(d.instrucao).toContain('search_knowledge');
    }
  });

  it('loja: "temos na cor azul" depois de a busca voltar vazia', () => {
    const d = decidirFundamentacao('Temos sim na cor azul!', ctx({ buscasFeitas: 1, buscasComFonte: 0 }));
    expect(d.pass).toBe(false);
    if (!d.pass) expect(d.instrucao).toContain('request_human_handoff');
  });

  it('loja, só-agente: a instrução não promete ninguém', () => {
    const d = decidirFundamentacao(
      'Temos sim na cor azul!',
      ctx({ modo: 'so_agente', buscasFeitas: 1, buscasComFonte: 0 }),
    );
    expect(d.pass).toBe(false);
    if (!d.pass) expect(d.instrucao).not.toContain('request_human_handoff');
  });

  it('loja: compatibilidade inventada', () => {
    expect(vetada('Essa capinha é compatível com o iPhone 15.', ctx({ buscasFeitas: 1, buscasComFonte: 1 }))).toBe(true);
  });

  it('imobiliária: característica e quantidade inventadas', () => {
    expect(
      vetada(
        'O apartamento da Rua das Flores aceita pet e tem 2 vagas de garagem.',
        ctx({ fontes: 'Você é o assistente da Imobiliária Lar. Seja cordial.' }),
      ),
    ).toBe(true);
  });

  it('prazo de entrega que nenhuma fonte deu', () => {
    expect(vetada('Entregamos em 3 dias úteis para todo o Brasil.', ctx({ buscasFeitas: 1, buscasComFonte: 1 }))).toBe(
      true,
    );
  });

  it('a fala do cliente NÃO é fonte de afirmação verbal', () => {
    const c = ctx({
      buscasFeitas: 1,
      buscasComFonte: 1,
      fontes: 'Camiseta básica: cores preto e branco.',
      fontesDeNumeros: 'Cliente: vocês têm a camiseta na cor azul marinho?',
    });
    expect(vetada('Temos sim a camiseta na cor azul marinho.', c)).toBe(true);
  });
});

describe('fundamentação — DEIXA PASSAR o que não afirma ou tem fonte', () => {
  it.each([
    'Oi, Maria! Tudo bem? Sou a Ana, assistente virtual da Clínica Sorriso.',
    'Qual o modelo do seu celular?',
    'Essa informação eu não tenho aqui, vou chamar alguém da equipe para te ajudar.',
    'Funciona assim: você me manda a foto do produto e eu verifico pra você.',
    'Fico feliz em ajudar! Posso te ajudar com mais alguma coisa?',
  ])('sem afirmação: %s', (body) => {
    expect(detectarAfirmacaoFactual(body)).toEqual([]);
    expect(decidirFundamentacao(body, ctx()).pass).toBe(true);
  });

  it('clínica: preço que está nas instruções, escrito de outro jeito', () => {
    expect(decidirFundamentacao('A avaliação custa R$ 150.', ctx()).pass).toBe(true);
  });

  it('clínica: horário que está nas instruções', () => {
    expect(decidirFundamentacao('Atendemos de segunda a sexta, das 8h às 18h.', ctx({ buscaDisponivel: false })).pass).toBe(
      true,
    );
  });

  it('loja: o que o trecho achado sustenta', () => {
    const c = ctx({
      buscasFeitas: 1,
      buscasComFonte: 1,
      fontes: `${INSTRUCOES_CLINICA}\nCamiseta Básica Algodão — cores disponíveis: azul, preto e branco. Preço: R$ 59,90`,
    });
    expect(decidirFundamentacao('Temos sim, a camiseta básica vem em azul, preto e branco por R$ 59,90.', c).pass).toBe(true);
  });

  it('número do pedido que o cliente citou + prazo que a ferramenta devolveu', () => {
    const c = ctx({
      fontes: `${INSTRUCOES_CLINICA}\n{"pedido":"48213","prazo_entrega_dias":3}`,
      fontesDeNumeros: `${INSTRUCOES_CLINICA}\n{"pedido":"48213","prazo_entrega_dias":3}\nCliente: e o meu pedido 48213?`,
    });
    expect(decidirFundamentacao('Seu pedido 48213 chega em 3 dias.', c).pass).toBe(true);
  });

  it('"Temos sim!" sem palavra de conteúdo passa quando a busca achou material', () => {
    expect(decidirFundamentacao('Temos sim!', ctx({ buscasFeitas: 1, buscasComFonte: 1 })).pass).toBe(true);
  });
});

describe('canonizarNumero', () => {
  it.each([
    ['1.299,90', '1299.9'],
    ['1299.90', '1299.9'],
    ['250,00', '250'],
    ['150', '150'],
    ['3', '3'],
  ])('%s ⇒ %s', (bruto, esperado) => {
    expect(canonizarNumero(bruto)).toBe(esperado);
  });
});
