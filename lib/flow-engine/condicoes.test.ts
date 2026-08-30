import { describe, expect, it } from "vitest";

import {
  avaliarGrupo,
  avaliarRegra,
  operadorPedeValor,
  PROFUNDIDADE_MAXIMA,
  resolverCampo,
  type Grupo,
  type Regra,
} from "./condicoes";

const escopo = {
  lead: {
    title: "Loja do Gabriel",
    score: 82,
    score_band: null,
    tags: ["quente", "meta-ads"],
    value_cents: 150_000,
    created_at: "2026-08-30T12:00:00.000Z",
    custom_fields: {},
  },
  contact: { name: "Gabriel", phone_number: "+559481004900" },
  vars: { tentativas: 0, lista_vazia: [], texto_em_branco: "   " },
};

function regra(campo: string, op: Regra["op"], valor?: unknown): Regra {
  return valor === undefined ? { campo, op } : { campo, op, valor };
}

describe("resolverCampo", () => {
  it("distingue campo ausente de campo presente valendo null", () => {
    expect(resolverCampo(escopo, "lead.score_band")).toEqual({ presente: true, valor: null });
    expect(resolverCampo(escopo, "lead.nao_existe")).toEqual({ presente: false, valor: undefined });
  });

  it("não estoura ao atravessar um não-objeto no meio do caminho", () => {
    expect(resolverCampo(escopo, "lead.title.qualquer.coisa")).toEqual({
      presente: false,
      valor: undefined,
    });
  });
});

describe("a regra de ausência", () => {
  // É a diferença deliberada em relação a lib/automation/conditions.ts:25, e o
  // motivo é medido: lead recém-criado não tem score, e lá "score != 70" seria
  // verdadeiro para ele.
  it("campo ausente é FALSO até para neq", () => {
    expect(avaliarRegra(regra("lead.score_inexistente", "neq", 70), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.score_inexistente", "eq", 70), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.score_inexistente", "gt", 70), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.score_inexistente", "lt", 70), escopo)).toBe(false);
  });

  it("campo presente valendo null também é ausência para comparação", () => {
    expect(avaliarRegra(regra("lead.score_band", "eq", "A"), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.score_band", "neq", "A"), escopo)).toBe(false);
  });

  it("empty e not_empty são o jeito de perguntar pela ausência", () => {
    expect(avaliarRegra(regra("lead.score_inexistente", "empty"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score_band", "empty"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score", "not_empty"), escopo)).toBe(true);
    expect(avaliarRegra(regra("vars.lista_vazia", "empty"), escopo)).toBe(true);
    expect(avaliarRegra(regra("vars.texto_em_branco", "empty"), escopo)).toBe(true);
  });

  it("CONTROLE: zero e string vazia não são ausência para comparação numérica", () => {
    // Se `0` fosse tratado como ausente, "tentativas eq 0" nunca casaria — e é
    // exatamente a condição que um fluxo de retentativa precisa fazer.
    expect(avaliarRegra(regra("vars.tentativas", "eq", 0), escopo)).toBe(true);
    expect(avaliarRegra(regra("vars.tentativas", "lt", 3), escopo)).toBe(true);
  });
});

describe("ordenação: número quando dá, texto quando não dá", () => {
  it("compara como número mesmo quando um dos lados é string numérica", () => {
    expect(avaliarRegra(regra("lead.score", "gt", "70"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score", "gt", 70), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score", "lte", 82), escopo)).toBe(true);
  });

  it("CONTROLE: sem a coerção, '9' > '10' seria verdadeiro por texto", () => {
    const nums = { a: 9 };
    expect(avaliarRegra({ campo: "a", op: "gt", valor: "10" }, nums)).toBe(false);
    expect(avaliarRegra({ campo: "a", op: "lt", valor: "10" }, nums)).toBe(true);
  });

  it("cai para texto quando os dois lados não são numéricos", () => {
    expect(avaliarRegra(regra("lead.title", "eq", "Loja do Gabriel"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.title", "neq", "Outra loja"), escopo)).toBe(true);
  });
});

describe("operadores de texto e lista", () => {
  it("contains em array é pertinência; em texto é substring sem caixa", () => {
    expect(avaliarRegra(regra("lead.tags", "contains", "quente"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.tags", "contains", "frio"), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.title", "contains", "GABRIEL"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.title", "not_contains", "Fulano"), escopo)).toBe(true);
  });

  it("starts_with e ends_with ignoram caixa", () => {
    expect(avaliarRegra(regra("lead.title", "starts_with", "loja"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.title", "ends_with", "GABRIEL"), escopo)).toBe(true);
  });

  it("in e not_in exigem lista do lado do valor", () => {
    expect(avaliarRegra(regra("lead.score", "in", [80, 82, 84]), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score", "not_in", [1, 2]), escopo)).toBe(true);
    // Valor que não é lista: `in` é falso, e `not_in` TAMBÉM — porque a regra
    // está mal formada, e responder "verdadeiro" a uma pergunta sem sentido
    // faria o fluxo seguir por um caminho que ninguém quis.
    expect(avaliarRegra(regra("lead.score", "in", "80"), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.score", "not_in", "80"), escopo)).toBe(false);
  });

  it("between usa um par [min, max], inclusivo nas pontas", () => {
    expect(avaliarRegra(regra("lead.score", "between", [80, 90]), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score", "between", [82, 82]), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.score", "between", [90, 100]), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.score", "between", [80]), escopo)).toBe(false);
  });
});

describe("datas", () => {
  it("before e after entendem ISO-8601", () => {
    expect(avaliarRegra(regra("lead.created_at", "before", "2026-09-01T00:00:00Z"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.created_at", "after", "2026-08-01T00:00:00Z"), escopo)).toBe(true);
    expect(avaliarRegra(regra("lead.created_at", "after", "2026-09-01T00:00:00Z"), escopo)).toBe(false);
  });

  it("data ilegível é falsa, não exceção", () => {
    expect(avaliarRegra(regra("lead.created_at", "before", "ontem de manhã"), escopo)).toBe(false);
    expect(avaliarRegra(regra("lead.title", "after", "2026-01-01"), escopo)).toBe(false);
  });
});

describe("regex", () => {
  it("casa o que deve casar", () => {
    expect(avaliarRegra(regra("contact.phone_number", "regex", "^\\+55"), escopo)).toBe(true);
    expect(avaliarRegra(regra("contact.phone_number", "regex", "^\\+1"), escopo)).toBe(false);
  });

  it("padrão inválido é FALSO e não derruba a execução", () => {
    expect(() => avaliarRegra(regra("lead.title", "regex", "([a-z"), escopo)).not.toThrow();
    expect(avaliarRegra(regra("lead.title", "regex", "([a-z"), escopo)).toBe(false);
  });

  it("padrão longo demais é recusado sem tentar compilar", () => {
    expect(avaliarRegra(regra("lead.title", "regex", "a".repeat(201)), escopo)).toBe(false);
    // CONTROLE: no limite ainda funciona, senão o teste acima passaria por
    // qualquer motivo.
    expect(avaliarRegra(regra("lead.title", "regex", `Loja${"|x".repeat(90)}`), escopo)).toBe(true);
  });
});

describe("grupos", () => {
  const quente: Regra = { campo: "lead.score", op: "gte", valor: 70 };
  const doMeta: Regra = { campo: "lead.tags", op: "contains", valor: "meta-ads" };
  const frio: Regra = { campo: "lead.score", op: "lt", valor: 10 };

  it("and exige todos; or exige um", () => {
    expect(avaliarGrupo({ combinador: "and", itens: [quente, doMeta] }, escopo)).toBe(true);
    expect(avaliarGrupo({ combinador: "and", itens: [quente, frio] }, escopo)).toBe(false);
    expect(avaliarGrupo({ combinador: "or", itens: [frio, doMeta] }, escopo)).toBe(true);
    expect(avaliarGrupo({ combinador: "or", itens: [frio] }, escopo)).toBe(false);
  });

  it("negar inverte o grupo inteiro, não o último item", () => {
    expect(avaliarGrupo({ combinador: "and", negar: true, itens: [quente, doMeta] }, escopo)).toBe(false);
    expect(avaliarGrupo({ combinador: "and", negar: true, itens: [quente, frio] }, escopo)).toBe(true);
  });

  it("aninha grupos", () => {
    const g: Grupo = {
      combinador: "and",
      itens: [quente, { combinador: "or", itens: [frio, doMeta] }],
    };
    expect(avaliarGrupo(g, escopo)).toBe(true);
  });

  it("aninhamento além do teto devolve falso em vez de estourar a pilha", () => {
    let g: Grupo = { combinador: "and", itens: [quente] };
    for (let i = 0; i < PROFUNDIDADE_MAXIMA + 3; i += 1) {
      g = { combinador: "and", itens: [g] };
    }
    expect(() => avaliarGrupo(g, escopo)).not.toThrow();
    expect(avaliarGrupo(g, escopo)).toBe(false);
    // CONTROLE: dentro do teto, o mesmo formato responde verdadeiro — sem isto
    // o teste acima passaria mesmo que TUDO devolvesse falso.
    let raso: Grupo = { combinador: "and", itens: [quente] };
    for (let i = 0; i < 2; i += 1) raso = { combinador: "and", itens: [raso] };
    expect(avaliarGrupo(raso, escopo)).toBe(true);
  });
});

describe("operadorPedeValor", () => {
  it("só empty e not_empty dispensam valor", () => {
    expect(operadorPedeValor("empty")).toBe(false);
    expect(operadorPedeValor("not_empty")).toBe(false);
    expect(operadorPedeValor("eq")).toBe(true);
    expect(operadorPedeValor("between")).toBe(true);
  });
});
