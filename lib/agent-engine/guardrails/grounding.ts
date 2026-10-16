/**
 * Conferência de FUNDAMENTAÇÃO — a mensagem afirma fato da empresa que nenhuma
 * fonte do turno sustenta?
 *
 * ═══ O DEFEITO MEDIDO ═══
 *
 * Produção, 14 dias até 2026-10-15: numa organização, 523 turnos do agente e só
 * 5 com busca no material. O agente respondia de memória — e "memória", para um
 * modelo, inclui o que ele sabe sobre produtos PARECIDOS. Nos turnos em que a
 * busca voltou vazia, todos enviaram mensagem mesmo assim. O playbook já mandava
 * não inventar; texto que orienta não é conferência.
 *
 * ═══ O QUE CONTA COMO FONTE ═══
 *
 * As instruções do agente (e a memória da organização), os trechos que a busca
 * achou NESTE turno e o resultado das ferramentas deste turno. A fala do CLIENTE
 * não é fonte de fato da empresa — "tem na cor azul?" não autoriza "temos sim na
 * cor azul" — e por isso há dois corpos:
 *
 *   - `fontes`: sem a conversa. É contra ele que se confere AFIRMAÇÃO VERBAL;
 *   - `fontesDeNumeros`: com a conversa e o bloco de data/hora. Número que o
 *     cliente disse (o pedido 12345, o orçamento dele) pode ser repetido.
 *
 * A camada plataforma do playbook também fica fora: ela cita "estoque", "preço"
 * e "prazo" em abstrato, e contaria como fonte de qualquer frase.
 *
 * ═══ A REGRA ═══
 *
 *   - NÚMERO (R$, %, prazo, parcela, data, hora, código de modelo): todo número da
 *     frase tem de aparecer nas fontes. Com busca ou sem.
 *   - AFIRMAÇÃO VERBAL ("temos", "entregamos", "vem com", "é compatível"…): pelo
 *     menos metade das palavras de conteúdo da frase tem de aparecer nas fontes.
 *     Frase sem palavra de conteúdo ("Temos sim!") não tem o que conferir: passa
 *     se alguma busca do turno achou material, e é vetada se a busca voltou vazia
 *     ou se havia busca disponível e ninguém buscou.
 *
 * Pergunta ao cliente, saudação e aviso de passagem não são afirmação. Erro aqui
 * custa caro nos dois sentidos — veto falso empurra para a passagem; falta de
 * veto deixa a invenção sair — e por isso o vocabulário é conservador e cada
 * lado tem frase real de nicho em `grounding.test.ts`.
 *
 * Puro e síncrono como todo gate: quem monta os corpos é o turno.
 */
import type { ModoSemFonte } from '@/lib/schemas/settings';

import { INSTRUCAO_BUSQUE_ANTES, instrucaoSemFonte } from '../agent/instrucao-sem-fonte';

export interface ContextoDeFundamentacao {
  modo: ModoSemFonte;
  /** A ferramenta `search_knowledge` está no turno (o agente tem material)? */
  buscaDisponivel: boolean;
  buscasFeitas: number;
  buscasComFonte: number;
  /** Instruções do agente + memória da org + trechos achados + resultados de ferramenta. SEM a conversa. */
  fontes: string;
  /** `fontes` + contexto do lead (com a conversa) + bloco de data/hora. Só para números. */
  fontesDeNumeros: string;
}

export type CategoriaDeAfirmacao =
  | 'preco'
  | 'percentual'
  | 'prazo'
  | 'parcela'
  | 'data'
  | 'hora'
  | 'quantidade'
  | 'codigo'
  | 'verbal';

export interface Afirmacao {
  categorias: CategoriaDeAfirmacao[];
  /** Números canônicos da frase (só quando há categoria numérica). */
  numeros: string[];
  /** Palavras de conteúdo da frase (normalizadas). */
  palavras: string[];
}

export type DecisaoDeFundamentacao =
  | { pass: true }
  | { pass: false; categorias: CategoriaDeAfirmacao[]; frases: number; semBusca: boolean; instrucao: string };

const semAcento = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const NUMERICOS: ReadonlyArray<[CategoriaDeAfirmacao, RegExp]> = [
  ['preco', /r\$\s?\d/],
  ['percentual', /\d\s?%/],
  ['prazo', /\b\d+\s?(?:dias?|horas?|hrs?|semanas?|meses|mes|minutos?|anos?)\b/],
  ['parcela', /\b\d{1,2}\s?x\b/],
  ['data', /\b\d{1,2}\/\d{1,2}\b/],
  ['hora', /\b\d{1,2}(?:h\d{0,2}|:\d{2})\b/],
  // "tem 2 vagas", "são 3 quartos", "com 40 m²": quantidade é fato do produto.
  ['quantidade', /\b(?:tem|temos|possui|possuimos|sao|com) \d+\b/],
];

/** Código de modelo/SKU no texto ORIGINAL (maiúsculas importam): A54, XR-200, S23. */
const CODIGO = /\b[A-Z]{1,4}-?\d{2,5}[A-Z]?\b/;

/**
 * Verbos e expressões de afirmação sobre a empresa. Lista FECHADA e curta:
 * "funciona" sozinho saiu ("funciona assim: você me manda…" é explicação do
 * atendimento, não fato do produto) — fica só o "funciona com/no/na/em/para".
 */
const VERBAL =
  /\b(?:temos|tem sim|nao temos|funciona (?:com|no|na|em|para|pra)|inclui|incluso|inclusa|acompanha|acompanham|esta disponivel|estao disponiveis|disponivel em|entregamos|fazemos entrega|aceitamos|aceita|possui|possuimos|atendemos|trabalhamos com|vem com|e compativel|sao compativeis|custa|custam|sai por|fica por|o valor e|o preco e|abrimos|fechamos|estamos localizad|ficamos (?:na|no|em)|nosso endereco)\b/;

/** Frase que não afirma nada da empresa: passagem, "não sei", oferta de ajuda. */
const NAO_E_AFIRMACAO =
  /\b(?:nao tenho (?:essa|esta|a) informac|nao sei|nao consigo (?:confirmar|te informar)|vou chamar|alguem da equipe|um atendente|uma pessoa da equipe|vou passar)\b/;

const PALAVRAS_SEM_CONTEUDO = new Set(
  (
    'voce voces gente nosso nossa nossos nossas isso esse essa esses essas este esta estes estas aqui tambem sobre ' +
    'todo toda todos todas cada qualquer pode podemos podem suas seus elas eles como quando onde entre mais muito ' +
    'muita muitos muitas ainda entao claro certo perfeito otimo olha assim sempre agora hoje amanha depois antes ' +
    'tudo nada algum alguma alguns algumas mesmo mesma outro outra outros outras porque pois para pela pelo pelas ' +
    'pelos desde seria sera esta estao estamos temos tenho inclui incluso inclusa acompanha acompanham disponivel ' +
    'disponiveis entregamos fazemos entrega aceitamos atendemos trabalhamos compativel compativeis custa custam ' +
    'valor preco abrimos fechamos localizado localizada ficamos endereco funciona aceita possui possuimos sim nao'
  ).split(' '),
);

function frasesDe(body: string): string[] {
  return body
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
}

/** Número canônico: "1.299,90" e "1299.90" viram "1299.9"; "250,00" vira "250". */
export function canonizarNumero(bruto: string): string {
  const s = bruto.replace(/\.(?=\d{3}(?!\d))/g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
}

function numerosDe(texto: string): string[] {
  return [...texto.matchAll(/\d[\d.,]*\d|\d/g)].map((m) => canonizarNumero(m[0]));
}

function palavrasDeConteudo(normalizada: string): string[] {
  return (normalizada.match(/\p{L}+/gu) ?? []).filter((p) => p.length >= 4 && !PALAVRAS_SEM_CONTEUDO.has(p));
}

/** A afirmação factual de UMA frase, ou `null` se ela não afirma nada da empresa. */
export function afirmacaoDaFrase(frase: string): Afirmacao | null {
  if (frase.endsWith('?')) return null;
  const n = semAcento(frase);
  if (NAO_E_AFIRMACAO.test(n)) return null;
  const categorias: CategoriaDeAfirmacao[] = NUMERICOS.filter(([, re]) => re.test(n)).map(([c]) => c);
  if (CODIGO.test(frase)) categorias.push('codigo');
  if (VERBAL.test(n)) categorias.push('verbal');
  if (categorias.length === 0) return null;
  const numerica = categorias.some((c) => c !== 'verbal');
  return { categorias, numeros: numerica ? numerosDe(n) : [], palavras: palavrasDeConteudo(n) };
}

/** As afirmações factuais da mensagem — vazio = nada a conferir. */
export function detectarAfirmacaoFactual(body: string): Afirmacao[] {
  return frasesDe(body)
    .map(afirmacaoDaFrase)
    .filter((a): a is Afirmacao => a !== null);
}

function contido(palavra: string, fontes: string): boolean {
  // Raiz curta tolera plural e gênero ("entregas"/"entrega", "básica"/"básico").
  const raiz = palavra.length > 5 ? palavra.slice(0, palavra.length - 2) : palavra;
  return fontes.includes(raiz);
}

export function decidirFundamentacao(body: string, ctx: ContextoDeFundamentacao): DecisaoDeFundamentacao {
  const afirmacoes = detectarAfirmacaoFactual(body);
  if (afirmacoes.length === 0) return { pass: true };

  const fontes = semAcento(ctx.fontes);
  const numerosDasFontes = new Set(numerosDe(semAcento(ctx.fontesDeNumeros)));
  const achouAlgo = ctx.buscasComFonte > 0;
  const semFonte = ctx.buscasFeitas > 0 && !achouAlgo;
  const naoBuscou = ctx.buscaDisponivel && ctx.buscasFeitas === 0;

  const semSustentacao = afirmacoes.filter((a) => {
    if (a.numeros.some((num) => !numerosDasFontes.has(num))) return true;
    if (!a.categorias.includes('verbal')) return false;
    if (a.palavras.length === 0) return semFonte || naoBuscou;
    const sustentadas = a.palavras.filter((p) => contido(p, fontes)).length;
    return sustentadas / a.palavras.length < 0.5;
  });
  if (semSustentacao.length === 0) return { pass: true };

  const categorias = [...new Set(semSustentacao.flatMap((a) => a.categorias))];
  return {
    pass: false,
    categorias,
    frases: semSustentacao.length,
    semBusca: naoBuscou,
    instrucao: naoBuscou ? INSTRUCAO_BUSQUE_ANTES : instrucaoSemFonte(ctx.modo),
  };
}

/**
 * O texto do veto que volta ao modelo. Não cita o trecho suspeito: o modelo tem a
 * própria mensagem, e o que vai ao trace são só as categorias (sem PII).
 */
export function renderVetoDeFundamentacao(decisao: Extract<DecisaoDeFundamentacao, { pass: false }>): string {
  return (
    'Esta mensagem afirma algo sobre a empresa que nenhuma fonte deste atendimento sustenta ' +
    '(o material da empresa, o resultado de uma ferramenta ou as suas instruções). Não envie. ' +
    decisao.instrucao
  );
}
