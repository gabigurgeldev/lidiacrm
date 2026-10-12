import { describe, expect, it } from "vitest";

import { pacotesQueCabem, type MapaDePacotes } from "./capacidades";
import { metaPromptDoAgente, metaPromptDosMateriais, SECOES_OBRIGATORIAS } from "./doutrina";
import { MAX_PERGUNTAS_POR_RODADA, MAX_RODADAS, promptDaEntrevista } from "./entrevista";
import { normalizarCobertura, normalizarEntrevista, normalizarGeracao, previaSchema, RESUMO_PADRAO } from "./esquemas";
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
  const sem = { cobertura: [] as Array<{ assunto: string; estado: "coberto" | "parcial" | "faltando"; evidencia: string }> };

  it("a terceira rodada é a última de PERGUNTAS; só a seguinte manda encerrar", () => {
    expect(promptDaEntrevista("generico", MAX_RODADAS)).toMatch(/última rodada de perguntas/);
    expect(promptDaEntrevista("generico", MAX_RODADAS)).not.toMatch(/A entrevista acabou/);
    expect(promptDaEntrevista("generico", MAX_RODADAS + 1)).toMatch(/A entrevista acabou/);
    expect(promptDaEntrevista("generico", 1)).not.toMatch(/última rodada/);
  });

  it("pergunta fechada com uma opção só vira aberta, com a opção como sugestão", () => {
    const r = normalizarEntrevista({
      kind: "perguntar",
      perguntas: [{ pergunta: "Qual o horário?", opcoes: ["8h às 18h"] }],
      ...sem,
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
      ...sem,
    });
    expect(r.kind === "perguntar" ? r.perguntas.map((p) => p.pergunta) : []).toHaveLength(MAX_PERGUNTAS_POR_RODADA);
  });

  // Até 2026-10-12 virava `pronto` aqui, em silêncio — uma das causas de "as
  // perguntas estão sendo puladas". Quem decide agora é `decidirRodada`.
  it("perguntar sem pergunta válida NÃO vira pronto: sai perguntar com lista vazia", () => {
    expect(normalizarEntrevista({ kind: "perguntar", perguntas: [], ...sem })).toEqual({
      kind: "perguntar",
      perguntas: [],
      nicho: null,
    });
    expect(normalizarEntrevista({ kind: "perguntar", perguntas: [{ pergunta: "   " }], ...sem }).kind).toBe("perguntar");
  });

  it("pronto sem resumo usa o resumo padrão", () => {
    expect(normalizarEntrevista({ kind: "pronto", resumo: " ", perguntas: [], ...sem })).toEqual({
      kind: "pronto",
      resumo: RESUMO_PADRAO,
      nicho: null,
      degradada: "pronto_sem_resumo",
    });
  });

  it("caminho feliz não leva marca de degradação", () => {
    expect(normalizarEntrevista({ kind: "pronto", resumo: "Agente X.", perguntas: [], ...sem })).not.toHaveProperty("degradada");
  });

  it("cobertura: só assuntos do checklist, primeiro vence, 'coberto' sem evidência vira 'parcial'", () => {
    const r = normalizarCobertura({
      kind: "pronto",
      perguntas: [],
      cobertura: [
        { assunto: "oferta", estado: "coberto", evidencia: "Buquê R$ 90" },
        { assunto: "Oferta", estado: "faltando", evidencia: "" },
        { assunto: "Assunto inventado", estado: "coberto", evidencia: "x" },
        { assunto: "Tom", estado: "coberto", evidencia: "  " },
      ],
    });
    expect(r).toEqual([
      { assunto: "Oferta", estado: "coberto" },
      { assunto: "Tom", estado: "parcial" },
    ]);
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
    coordenacao: {
      quando_usar: "Agendamento de consultas e dúvidas sobre tratamentos.",
      exemplos: ["quero marcar uma consulta", "Quero marcar uma consulta", "quanto custa o clareamento?"],
      nao_usar: ["segunda via de boleto"],
    },
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

  it("a coordenação sai pronta para o coordenador: incluída por padrão, exemplos sem repetição", () => {
    const p = normalizarGeracao({ ...agente, pacotes: [...agente.pacotes] }, { materiais: [] });
    expect(p.coordenacao).toEqual({
      incluir: true,
      quando_usar: "Agendamento de consultas e dúvidas sobre tratamentos.",
      exemplos: ["quero marcar uma consulta", "quanto custa o clareamento?"],
      nao_usar: ["segunda via de boleto"],
      fluxos_chamaveis: [],
    });
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
