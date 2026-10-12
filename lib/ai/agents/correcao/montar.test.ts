import { describe, expect, it } from "vitest";

import { contarMudancas, diffDeLinhas } from "@/lib/ui/diff-de-linhas";
import type { VersionInput } from "@/lib/ai/agents/validation";

import type { Proposta, SaidaDaProposta } from "./esquemas";
import {
  achadosNovos,
  ferramentasCorrigidas,
  frasesCorrigidas,
  normalizarDiagnostico,
  normalizarProposta,
  propostaVazia,
  resumoDaCorrecao,
  versaoCorrigida,
} from "./montar";

/**
 * Corrigir agente com IA — o que é puro: aparar a resposta do modelo contra a
 * versão base e montar a versão corrigida. É a MESMA montagem no teste (tela)
 * e no aplicar (servidor): o que se testa é o que se grava.
 */

const MAPA = {
  atender: ["read_conversation", "search_knowledge"],
  vender: ["crm_create_lead", "search_knowledge"],
  reter: [],
  escalar: ["handoff"],
  organizar: [],
  evoluir: [],
} as const;

const BASE = {
  id: "11111111-1111-4111-8111-111111111111",
  system_prompt: "Quem você é: a Bia.",
  handoff_keywords: ["atendente"],
  materiais: [
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nome: "Tabela de preços" },
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nome: "Perguntas frequentes" },
  ],
};

function saida(over: Partial<SaidaDaProposta> = {}): SaidaDaProposta {
  return {
    explicacao: "Ok.",
    system_prompt: "Quem você é: a Bia. Nunca dê desconto.",
    mudancas_no_prompt: [],
    materiais_novos: [],
    materiais_desligar: [],
    pacotes_ligar: [],
    pacotes_desligar: [],
    frases_de_passagem_adicionar: [],
    frases_de_passagem_remover: [],
    mensagem_de_teste: "Tem desconto?",
    ...over,
  };
}

describe("normalizarProposta", () => {
  it("desliga material só pelo nome de um que está ligado", () => {
    const p = normalizarProposta(
      saida({
        materiais_desligar: [
          { nome: "tabela de preços ", por_que: "Desatualizada." },
          { nome: "Material que não existe", por_que: "" },
        ],
      }),
      BASE,
    );
    expect(p.materiais_desligar).toEqual([{ valor: BASE.materiais[0]!.id, por_que: "Desatualizada." }]);
  });

  it("ligar e desligar o mesmo pacote se anulam", () => {
    const p = normalizarProposta(
      saida({
        pacotes_ligar: [{ pacote: "vender", por_que: "" }, { pacote: "escalar", por_que: "" }],
        pacotes_desligar: [{ pacote: "vender", por_que: "" }],
      }),
      BASE,
    );
    expect(p.pacotes_ligar.map((x) => x.valor)).toEqual(["escalar"]);
    expect(p.pacotes_desligar).toEqual([]);
  });

  it("frase nova que já existe não entra; remover só o que existe", () => {
    const p = normalizarProposta(
      saida({ frases_de_passagem_adicionar: ["Atendente", "gerente"], frases_de_passagem_remover: ["atendente", "humano"] }),
      BASE,
    );
    expect(p.frases_de_passagem_adicionar).toEqual(["gerente"]);
    expect(p.frases_de_passagem_remover).toEqual(["atendente"]);
  });

  it("prompt vazio não apaga o que existe; material sem conteúdo some", () => {
    const p = normalizarProposta(
      saida({ system_prompt: "  ", materiais_novos: [{ tipo: "faq", nome: "Vazio", itens: [], por_que: "" }] }),
      BASE,
    );
    expect(p.system_prompt).toBe(BASE.system_prompt);
    expect(p.materiais_novos).toEqual([]);
  });
});

describe("ferramentasCorrigidas", () => {
  it("desligar um pacote não tira o que pertence a outro que segue ligado", () => {
    const atuais = ["read_conversation", "search_knowledge", "crm_create_lead"];
    // vender = crm_create_lead + search_knowledge; atender segue ligado e também tem search_knowledge.
    expect(ferramentasCorrigidas(atuais, [], ["vender"], MAPA)).toEqual(["read_conversation", "search_knowledge"]);
  });

  it("ligar acrescenta o que falta, sem duplicar, e respeita a ordem do catálogo", () => {
    const r = ferramentasCorrigidas(["search_knowledge"], ["escalar", "atender"], [], MAPA, [
      "read_conversation",
      "search_knowledge",
      "handoff",
    ]);
    expect(r).toEqual(["read_conversation", "search_knowledge", "handoff"]);
  });
});

describe("versaoCorrigida", () => {
  const base = {
    system_prompt: "Quem você é: a Bia.",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    credential_id: null,
    tool_ids: ["read_conversation", "search_knowledge"],
    channel_session_id: "22222222-2222-4222-8222-222222222222",
    handoff_keywords: ["atendente"],
    knowledge_source_ids: [BASE.materiais[0]!.id, BASE.materiais[1]!.id],
    max_steps: 7,
  } as unknown as VersionInput;

  const p: Proposta = normalizarProposta(
    saida({
      materiais_desligar: [{ nome: "Tabela de preços", por_que: "" }],
      pacotes_ligar: [{ pacote: "escalar", por_que: "" }],
      frases_de_passagem_adicionar: ["gerente"],
    }),
    BASE,
  );

  it("muda prompt, ferramentas, frases e acervo — e mais nada", () => {
    const v = versaoCorrigida(base, p, true, MAPA, { idsDosMateriaisNovos: ["cccccccc-cccc-4ccc-8ccc-cccccccccccc"] });
    expect(v.system_prompt).toBe("Quem você é: a Bia. Nunca dê desconto.");
    expect(v.tool_ids).toEqual(["read_conversation", "search_knowledge", "handoff"]);
    expect(v.handoff_keywords).toEqual(["atendente", "gerente"]);
    expect(v.knowledge_source_ids).toEqual([BASE.materiais[1]!.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
    expect(v.max_steps).toBe(7);
    expect(v.channel_session_id).toBe(base.channel_session_id);
  });

  it("prompt recusado: fica o da base", () => {
    expect(versaoCorrigida(base, p, false, MAPA).system_prompt).toBe(base.system_prompt);
  });
});

describe("pequenos", () => {
  it("frasesCorrigidas remove sem diferenciar maiúscula e não duplica", () => {
    expect(frasesCorrigidas(["Atendente", "humano"], ["HUMANO", "gerente"], ["atendente"])).toEqual(["humano", "gerente"]);
  });

  it("resumoDaCorrecao cabe numa linha", () => {
    expect(resumoDaCorrecao("  dá\n desconto  ")).toBe("Correção com IA: dá desconto");
    expect(resumoDaCorrecao("x".repeat(400)).length).toBeLessThanOrEqual(220);
  });

  it("propostaVazia: só prompt igual e listas vazias", () => {
    const p = normalizarProposta(saida({ system_prompt: BASE.system_prompt }), BASE);
    expect(propostaVazia(p, true, BASE.system_prompt)).toBe(true);
    expect(propostaVazia({ ...p, frases_de_passagem_adicionar: ["x"] }, true, BASE.system_prompt)).toBe(false);
  });

  it("achadosNovos mostra só o que a correção piorou", () => {
    const antigo = { nivel: "aviso" as const, regra: "secao_faltando" as const, mensagem: "Falta a seção X." };
    const novo = { nivel: "erro" as const, regra: "fato_inventado" as const, mensagem: "R$ 99 não está no material." };
    expect(achadosNovos([antigo], [antigo, novo])).toEqual([novo]);
  });

  it("normalizarDiagnostico apara e limita perguntas", () => {
    const d = normalizarDiagnostico({
      resumo: "",
      hipoteses: [{ causa: "Regra sem alternativa", evidencia: "Nunca dê desconto.", onde: "prompt" }],
      perguntas: Array.from({ length: 5 }, (_, i) => ({ pergunta: `P${i}?`, opcoes: ["a"] })),
    });
    expect(d.resumo.length).toBeGreaterThan(0);
    expect(d.perguntas).toHaveLength(3);
    // Uma opção só não é escolha: vira resposta livre.
    expect(d.perguntas[0]?.resposta_livre).toBe(true);
  });

  it("diffDeLinhas marca o que entrou e saiu", () => {
    const linhas = diffDeLinhas("a\nb\nc", "a\nB\nc\nd");
    expect(linhas.map((l) => `${l.kind}:${l.text}`)).toEqual(["ctx:a", "del:b", "add:B", "ctx:c", "add:d"]);
    expect(contarMudancas(linhas)).toEqual({ entraram: 2, sairam: 1 });
  });
});
