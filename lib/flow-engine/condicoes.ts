/**
 * Flow Engine — o avaliador de condições. Puro, sem I/O.
 *
 * ─── Por que operadores estruturados, e não um interpretador ────────────────
 * A alternativa seria uma engine de expressão (`{{ lead.value * 0.1 > 100 }}`).
 * Ela é superfície de ataque de verdade — precisa nascer com teto de recursão,
 * limite de tempo e fuzzing — e nenhum fluxo desta entrega precisa de
 * aritmética. Operadores estruturados cobrem a lista inteira que o produto
 * pediu, com um avaliador que cabe num arquivo e é exaustivamente testável.
 *
 * ─── A regra de ausência, e por que ela difere de lib/automation ────────────
 * `lib/automation/conditions.ts:25` trata campo ausente como VERDADEIRO para
 * `neq`. Aqui não: campo ausente é FALSO para todo operador, exceto `empty`
 * (verdadeiro) e `not_empty` (falso).
 *
 * O motivo é medido, não estético. `crm_lead_scores` só é escrito por
 * `recalculaScoreDoLead`, chamado do turno de conversa — então um lead
 * recém-criado NÃO TEM score. Com a regra do outro motor, "score != 70"
 * dispararia para todo lead novo, e um fluxo de qualificação trataria como
 * "não qualificado" quem ainda não foi avaliado. Ausência não é diferença; é
 * ausência, e quem quer perguntar por ela tem `empty` para isso.
 */

import { z } from "zod";

// ────────────────────────────── vocabulário ──────────────────────────────────

export const OPERADORES = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "not_contains",
  "starts_with",
  "ends_with",
  "empty",
  "not_empty",
  "in",
  "not_in",
  "regex",
  "before",
  "after",
  "between",
] as const;
export type Operador = (typeof OPERADORES)[number];

/** Operadores que não olham `valor` — pedir um seria ruído na tela. */
const SEM_VALOR: ReadonlySet<Operador> = new Set(["empty", "not_empty"]);

/**
 * Teto do padrão de `regex`. Não elimina ReDoS — JavaScript não tem timeout de
 * expressão regular, e a correção de verdade seria um motor sem backtracking
 * (RE2). Limita o estrago: padrão curto e assunto curto (ver `LIMITE_DO_ASSUNTO`)
 * mantêm o pior caso praticável.
 *
 * O risco residual é aceitável NESTE produto porque quem escreve o padrão é o
 * administrador da própria instalação self-host — é o dono do worker travando o
 * próprio worker. Num SaaS multi-tenant a conta seria outra, e este comentário
 * é o aviso para quem for por esse caminho.
 */
const LIMITE_DO_PADRAO = 200;
const LIMITE_DO_ASSUNTO = 1000;

export const regraSchema = z.strictObject({
  /** Caminho por ponto no escopo: `lead.score`, `vars.tentativas`. */
  campo: z.string().min(1).max(120),
  op: z.enum(OPERADORES),
  valor: z.unknown().optional(),
});
export type Regra = z.infer<typeof regraSchema>;

export type Combinador = "and" | "or";

export interface Grupo {
  combinador: Combinador;
  /** Inverte o resultado do grupo inteiro — é o NOT. */
  negar?: boolean;
  itens: Array<Regra | Grupo>;
}

/** Profundidade máxima de aninhamento. Não é estilo: é o teto de recursão. */
export const PROFUNDIDADE_MAXIMA = 5;

export const grupoSchema: z.ZodType<Grupo> = z.lazy(() =>
  z.strictObject({
    combinador: z.enum(["and", "or"]),
    negar: z.boolean().optional(),
    itens: z.array(z.union([regraSchema, grupoSchema])).min(1).max(20),
  }),
);

// ───────────────────────────── resolução de campo ────────────────────────────

/**
 * Anda o caminho por ponto sem lançar. Mesma ideia de
 * `lib/automation/conditions.ts:14`, reescrita aqui por um motivo: aquela
 * versão devolve `undefined` tanto para "não existe" quanto para "existe e vale
 * undefined", e este avaliador precisa distinguir ausência de presença.
 */
export function resolverCampo(
  escopo: unknown,
  caminho: string,
): { presente: boolean; valor: unknown } {
  let atual: unknown = escopo;
  for (const parte of caminho.split(".")) {
    if (atual === null || atual === undefined || typeof atual !== "object") {
      return { presente: false, valor: undefined };
    }
    if (!(parte in (atual as Record<string, unknown>))) {
      return { presente: false, valor: undefined };
    }
    atual = (atual as Record<string, unknown>)[parte];
  }
  return { presente: true, valor: atual };
}

// ───────────────────────────────── coerções ──────────────────────────────────

function comoNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function comoData(v: unknown): number | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function comoTexto(v: unknown): string {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(comoTexto).join(",");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Vazio: null, string em branco, array sem itens, objeto sem chaves. */
function estaVazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

// ───────────────────────────── avaliação de regra ────────────────────────────

/**
 * Compara dois valores com a régua mais forte que os DOIS aceitarem: número se
 * ambos forem numéricos, senão texto. Sem isso, `"9" > "10"` (comparação de
 * texto) devolveria verdadeiro — e ninguém que escreve "score > 10" numa tela
 * espera isso.
 */
function ordena(a: unknown, b: unknown): number | null {
  const na = comoNumero(a);
  const nb = comoNumero(b);
  if (na !== null && nb !== null) return na === nb ? 0 : na < nb ? -1 : 1;
  const ta = comoTexto(a);
  const tb = comoTexto(b);
  return ta === tb ? 0 : ta < tb ? -1 : 1;
}

export function avaliarRegra(regra: Regra, escopo: unknown): boolean {
  const { presente, valor } = resolverCampo(escopo, regra.campo);
  const alvo = regra.valor;

  if (regra.op === "empty") return !presente || estaVazio(valor);
  if (regra.op === "not_empty") return presente && !estaVazio(valor);

  // A regra de ausência — ver o cabeçalho. Ausência não é diferença.
  if (!presente || valor === null || valor === undefined) return false;

  switch (regra.op) {
    case "eq":
      return ordena(valor, alvo) === 0;
    case "neq":
      return ordena(valor, alvo) !== 0;
    case "gt": {
      const c = ordena(valor, alvo);
      return c !== null && c > 0;
    }
    case "gte": {
      const c = ordena(valor, alvo);
      return c !== null && c >= 0;
    }
    case "lt": {
      const c = ordena(valor, alvo);
      return c !== null && c < 0;
    }
    case "lte": {
      const c = ordena(valor, alvo);
      return c !== null && c <= 0;
    }
    case "contains":
      // Em array, pertinência de item. Em texto, substring sem diferenciar
      // maiúscula — é o que "contém" significa numa tela de operação.
      return Array.isArray(valor)
        ? valor.map(comoTexto).includes(comoTexto(alvo))
        : comoTexto(valor).toLowerCase().includes(comoTexto(alvo).toLowerCase());
    case "not_contains":
      return !(Array.isArray(valor)
        ? valor.map(comoTexto).includes(comoTexto(alvo))
        : comoTexto(valor).toLowerCase().includes(comoTexto(alvo).toLowerCase()));
    case "starts_with":
      return comoTexto(valor).toLowerCase().startsWith(comoTexto(alvo).toLowerCase());
    case "ends_with":
      return comoTexto(valor).toLowerCase().endsWith(comoTexto(alvo).toLowerCase());
    case "in":
      return Array.isArray(alvo) && alvo.map(comoTexto).includes(comoTexto(valor));
    case "not_in":
      return Array.isArray(alvo) && !alvo.map(comoTexto).includes(comoTexto(valor));
    case "regex": {
      const padrao = comoTexto(alvo);
      if (padrao === "" || padrao.length > LIMITE_DO_PADRAO) return false;
      const assunto = comoTexto(valor).slice(0, LIMITE_DO_ASSUNTO);
      try {
        return new RegExp(padrao, "u").test(assunto);
      } catch {
        // Padrão inválido é FALSO, nunca exceção: uma regra mal escrita não
        // pode derrubar a execução inteira e mandar o fluxo para `dead`.
        return false;
      }
    }
    case "before": {
      const a = comoData(valor);
      const b = comoData(alvo);
      return a !== null && b !== null && a < b;
    }
    case "after": {
      const a = comoData(valor);
      const b = comoData(alvo);
      return a !== null && b !== null && a > b;
    }
    case "between": {
      if (!Array.isArray(alvo) || alvo.length !== 2) return false;
      const [min, max] = alvo;
      const cMin = ordena(valor, min);
      const cMax = ordena(valor, max);
      return cMin !== null && cMax !== null && cMin >= 0 && cMax <= 0;
    }
  }
}

// ───────────────────────────── avaliação de grupo ────────────────────────────

function ehGrupo(item: Regra | Grupo): item is Grupo {
  return typeof item === "object" && item !== null && "itens" in item;
}

export function avaliarGrupo(grupo: Grupo, escopo: unknown, profundidade = 0): boolean {
  // Teto de recursão. Um grafo vindo de import pode ter sido montado à mão, e
  // aninhamento sem fim vira estouro de pilha DENTRO do worker — que derrubaria
  // o processo inteiro, não só esta execução.
  if (profundidade > PROFUNDIDADE_MAXIMA) return false;

  const avaliados = grupo.itens.map((item) =>
    ehGrupo(item)
      ? avaliarGrupo(item, escopo, profundidade + 1)
      : avaliarRegra(item, escopo),
  );
  const juntos =
    grupo.combinador === "and" ? avaliados.every(Boolean) : avaliados.some(Boolean);
  return grupo.negar === true ? !juntos : juntos;
}

/** Um operador precisa de `valor`? A tela usa para esconder o campo. */
export function operadorPedeValor(op: Operador): boolean {
  return !SEM_VALOR.has(op);
}
