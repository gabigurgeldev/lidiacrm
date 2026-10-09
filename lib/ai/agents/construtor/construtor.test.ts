import { describe, expect, it } from "vitest";

import { pacotesQueCabem, type MapaDePacotes } from "./capacidades";
import { metaPromptDoAgente, metaPromptDosMateriais, SECOES_OBRIGATORIAS } from "./doutrina";
import { MAX_PERGUNTAS_POR_RODADA, MAX_RODADAS, promptDaEntrevista } from "./entrevista";
import { normalizarEntrevista, normalizarGeracao, previaSchema } from "./esquemas";
import { NICHOS, nichoDoTexto } from "./nicho";

/**
 * O construtor de agente, nas partes que não dependem de modelo nem de banco.
 *
 * O que mais importa aqui é a DOUTRINA: o meta-prompt é texto, e texto se edita
 * às pressas. Uma edição que tire "não invente preço" ou "quando chamar uma
 * pessoa" não quebra typecheck nem tela nenhuma — só faz o agente gerado
 * prometer o que o dono não autorizou. O teste é a cerca barata contra isso.
 */

describe("doutrina do gerador", () => {
  it.each(NICHOS)("nicho %s: o meta-prompt exige todas as seções obrigatórias", (nicho) => {
    const meta = metaPromptDoAgente(nicho);
    for (const secao of SECOES_OBRIGATORIAS) expect(meta).toContain(`${secao}:`);
  });

  it("carrega as regras que protegem o dono — não inventar, chamar pessoa, opt-out, não fingir humano", () => {
    const meta = metaPromptDoAgente("generico");
    expect(meta).toMatch(/SÓ podem sair do conhecimento/);
    expect(meta).toMatch(/vou confirmar com a equipe/);
    expect(meta).toMatch(/nunca finge ser humano/);
    expect(meta).toMatch(/parar de receber mensagens/);
    expect(meta).toMatch(/Nada de tabela/);
  });

  it("saúde proíbe diagnóstico e manda urgência para o 192", () => {
    const meta = metaPromptDoAgente("clinica");
    expect(meta).toMatch(/nunca diagnostica/);
    expect(meta).toMatch(/192/);
  });

  it("materiais: um fato num lugar só, item autocontido, nada inventado", () => {
    const meta = metaPromptDosMateriais("loja");
    expect(meta).toMatch(/Um fato mora em UM lugar/);
    expect(meta).toMatch(/se sustenta sozinho/);
    expect(meta).toMatch(/Nada de preço, prazo ou política inventados/);
    expect(meta).toMatch(/7 dias/);
  });
});

describe("nicho", () => {
  it("reconhece o ramo pelo vocabulário e cai em generico quando não reconhece", () => {
    expect(nichoDoTexto("Somos uma clínica odontológica em Curitiba")).toBe("clinica");
    expect(nichoDoTexto("Imobiliária com apartamentos para alugar")).toBe("imobiliaria");
    expect(nichoDoTexto("blablabla")).toBe("generico");
  });
});

describe("entrevista", () => {
  it("a última rodada manda encerrar", () => {
    expect(promptDaEntrevista("generico", MAX_RODADAS)).toMatch(/ÚLTIMA RODADA/);
    expect(promptDaEntrevista("generico", 1)).not.toMatch(/ÚLTIMA RODADA/);
  });

  it("pergunta fechada com uma opção só vira aberta, com a opção como sugestão", () => {
    const r = normalizarEntrevista({
      kind: "perguntar",
      perguntas: [{ pergunta: "Qual o horário?", opcoes: ["8h às 18h"] }],
    });
    expect(r).toEqual({
      kind: "perguntar",
      nicho: null,
      perguntas: [{ pergunta: "Qual o horário?", opcoes: [], resposta_livre: true, sugestao: "8h às 18h" }],
    });
  });

  it("descarta pergunta vazia e corta no teto por rodada", () => {
    const r = normalizarEntrevista({
      kind: "perguntar",
      perguntas: [
        { pergunta: "  " },
        ...Array.from({ length: 6 }, (_, i) => ({ pergunta: `P${i}`, resposta_livre: true })),
      ],
    });
    expect(r?.kind).toBe("perguntar");
    expect(r && r.kind === "perguntar" ? r.perguntas.map((p) => p.pergunta) : []).toHaveLength(
      MAX_PERGUNTAS_POR_RODADA,
    );
  });

  it("incoerente: perguntar sem pergunta, ou pronto sem resumo", () => {
    expect(normalizarEntrevista({ kind: "perguntar", perguntas: [] })).toBeNull();
    expect(normalizarEntrevista({ kind: "pronto", resumo: " " })).toBeNull();
  });
});

describe("normalizarGeracao", () => {
  const agente = {
    nome: "Bia",
    descricao: "Atende a clínica",
    system_prompt: "Quem você é: a Bia.",
    pacotes: ["atender", "atender", "escalar"] as const,
    handoff_keywords: ["atendente", "Atendente", " ", "humano"],
    lacunas: ["preço do clareamento"],
  };

  it("material vazio some, nome repetido ganha sufixo, item vazio sai", () => {
    const p = normalizarGeracao(
      { ...agente, pacotes: [...agente.pacotes] },
      {
        materiais: [
          { tipo: "faq", nome: "Perguntas frequentes", itens: [{ pergunta: "Q", resposta: "R" }, { pergunta: "", resposta: "x" }] },
          { tipo: "faq", nome: "Perguntas frequentes", itens: [{ pergunta: "Q2", resposta: "R2" }] },
          { tipo: "documento", nome: "Vazio", texto: "   " },
          { tipo: "documento", nome: "Sobre", texto: "A clínica…" },
        ],
      },
    );
    expect(p.materiais.map((m) => m.nome)).toEqual(["Perguntas frequentes", "Perguntas frequentes (2)", "Sobre"]);
    expect(p.materiais[0]).toMatchObject({ itens: [{ pergunta: "Q", resposta: "R" }] });
    expect(p.pacotes).toEqual(["atender", "escalar"]);
    expect(p.handoff_keywords).toEqual(["atendente", "humano"]);
    expect(p.lacunas).toEqual(["preço do clareamento"]);
  });

  it("a prévia normalizada passa no schema da criação (com o canal que a tela escolhe)", () => {
    const p = normalizarGeracao(
      { ...agente, pacotes: [...agente.pacotes] },
      { materiais: [{ tipo: "documento", nome: "Sobre", texto: "Texto" }] },
    );
    const { lacunas: _l, ...resto } = p;
    const r = previaSchema.safeParse({ ...resto, channel_session_id: "11111111-1111-4111-8111-111111111111" });
    expect(r.success).toBe(true);
  });

  it("a criação RECUSA campo que não é da prévia — organization_id do corpo não entra", () => {
    const r = previaSchema.safeParse({
      nome: "Bia",
      system_prompt: "Quem você é: a Bia.",
      pacotes: [],
      handoff_keywords: [],
      materiais: [],
      channel_session_id: "11111111-1111-4111-8111-111111111111",
      organization_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(r.success).toBe(false);
  });
});

describe("pacotesQueCabem", () => {
  const mapa: MapaDePacotes = {
    atender: ["a1", "a2", "c"],
    vender: ["v1", "v2", "c"],
    reter: ["r1"],
    escalar: ["e1"],
    organizar: [],
    evoluir: [],
  };

  it("liga na ordem pedida enquanto cabe e devolve o que ficou de fora", () => {
    expect(pacotesQueCabem(["atender", "vender", "reter"], mapa, 4)).toEqual({
      cabem: ["atender", "reter"],
      foraDoTeto: ["vender"],
    });
  });

  it("ferramenta compartilhada entre pacotes conta uma vez só", () => {
    expect(pacotesQueCabem(["atender", "vender"], mapa, 5)).toEqual({ cabem: ["atender", "vender"], foraDoTeto: [] });
  });
});
