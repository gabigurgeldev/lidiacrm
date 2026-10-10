/**
 * Expressão regular escrita por quem usa a tela — com teto e sem as formas que
 * travam o processo.
 *
 * JavaScript não tem timeout de regex, e um padrão como `(a+)+$` contra um
 * texto de 30 letras "a" seguido de "b" leva o worker a minutos de CPU
 * (backtracking exponencial). A correção de verdade seria um motor sem
 * backtracking (RE2); o que dá para fazer sem ele é:
 *
 *  - padrão curto (`LIMITE_DO_PADRAO`) e assunto curto (`LIMITE_DO_ASSUNTO`);
 *  - recusar, NA HORA DE SALVAR, as duas construções que tornam o pior caso
 *    exponencial e que ninguém precisa para filtrar assunto: quantificador
 *    sobre um grupo que já tem quantificador ilimitado dentro (`(a+)+`,
 *    `(\w*\s)*`) e referência reversa (`(a)\1`).
 *
 * O detector é conservador de propósito: ele não acha toda regex lenta (uma
 * alternação com sobreposição como `(a|a)*` passa), mas não recusa nenhuma
 * lista de palavras — e lista de palavras é o que a tela produz.
 *
 * Quem escreve o padrão é o administrador da própria instalação self-host. O
 * risco residual é o dono travando o próprio worker, e é aceito por isso; num
 * SaaS multi-tenant a conta seria outra (ver `lib/flow-engine/condicoes.ts`).
 */

export const LIMITE_DO_PADRAO = 200;
export const LIMITE_DO_ASSUNTO = 1000;

export type ProblemaDoPadrao =
  | 'vazio'
  | 'longo_demais'
  | 'invalido'
  | 'quantificador_aninhado'
  | 'referencia_reversa';

/** Por que o padrão não pode ser usado — ou `null` quando pode. */
export function problemaDoPadrao(padrao: string): ProblemaDoPadrao | null {
  if (padrao.trim() === '') return 'vazio';
  if (padrao.length > LIMITE_DO_PADRAO) return 'longo_demais';
  try {
    new RegExp(padrao, 'iu');
  } catch {
    return 'invalido';
  }
  return riscoDeBacktracking(padrao);
}

/** Compila só o que passou em `problemaDoPadrao`; o resto devolve `null`. */
export function compilarSeguro(padrao: string, flags = 'iu'): RegExp | null {
  if (problemaDoPadrao(padrao) !== null) return null;
  try {
    return new RegExp(padrao, flags);
  } catch {
    return null;
  }
}

/**
 * Varre o padrão uma vez, sem compilar: acompanha classes `[...]`, escapes e a
 * pilha de grupos. Um grupo "tem ilimitado" quando contém `*`, `+` ou `{n,}`
 * (direta ou indiretamente); se ele próprio for repetido por `*`, `+` ou `{`,
 * o pior caso é exponencial.
 */
function riscoDeBacktracking(padrao: string): ProblemaDoPadrao | null {
  const grupos: boolean[] = [];
  let naClasse = false;

  const ilimitadoEm = (i: number): boolean => {
    const c = padrao[i];
    if (c === '*' || c === '+') return true;
    if (c !== '{') return false;
    const m = /^\{(\d+)(,(\d*))?\}/.exec(padrao.slice(i));
    return m !== null && m[2] !== undefined && (m[3] === '' || Number(m[3]) > 10);
  };
  const quantificadoEm = (i: number): boolean => {
    const c = padrao[i];
    return c === '*' || c === '+' || (c === '{' && /^\{\d+(,\d*)?\}/.test(padrao.slice(i)));
  };
  const marcarNoTopo = () => {
    if (grupos.length > 0) grupos[grupos.length - 1] = true;
  };

  for (let i = 0; i < padrao.length; i++) {
    const c = padrao[i]!;
    if (c === '\\') {
      const prox = padrao[i + 1] ?? '';
      if (!naClasse && (/[1-9]/.test(prox) || (prox === 'k' && padrao[i + 2] === '<'))) {
        return 'referencia_reversa';
      }
      i++;
      if (ilimitadoEm(i + 1)) marcarNoTopo();
      continue;
    }
    if (naClasse) {
      if (c === ']') {
        naClasse = false;
        if (ilimitadoEm(i + 1)) marcarNoTopo();
      }
      continue;
    }
    if (c === '[') {
      naClasse = true;
      continue;
    }
    if (c === '(') {
      grupos.push(false);
      continue;
    }
    if (c === ')') {
      const tinhaIlimitado = grupos.pop() ?? false;
      if (tinhaIlimitado && quantificadoEm(i + 1)) return 'quantificador_aninhado';
      if (tinhaIlimitado || ilimitadoEm(i + 1)) marcarNoTopo();
      continue;
    }
    if (ilimitadoEm(i + 1) && c !== '|' && c !== '^' && c !== '$') marcarNoTopo();
  }
  return null;
}

/** Frase para quem está na tela — em português, sem termo de regex. */
export function explicarProblemaDoPadrao(p: ProblemaDoPadrao): string {
  switch (p) {
    case 'vazio':
      return 'O filtro está vazio.';
    case 'longo_demais':
      return `O filtro passou de ${LIMITE_DO_PADRAO} caracteres.`;
    case 'invalido':
      return 'O filtro tem um erro de escrita (parêntese ou colchete sem par, por exemplo).';
    case 'quantificador_aninhado':
      return 'O filtro repete um trecho que já se repete, como (a+)+. Isso pode travar o atendimento — simplifique.';
    case 'referencia_reversa':
      return 'O filtro usa referência a um trecho anterior (\\1). Isso não é aceito aqui.';
  }
}
