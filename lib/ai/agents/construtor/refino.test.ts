import { describe, expect, it } from "vitest";
import type { z } from "zod";

import { PREFIXO_DO_ANEXO, sincronizarAnexosGuardados } from "./anexos-guardados";
import { TETO_DE_MATERIAIS, type PreviaGerada, type saidaDoRefinoSchema } from "./esquemas";
import { descreverPrevia, mesclarRefino } from "./refino";

/**
 * O "ajustar pelo chat" do construtor, nas partes puras:
 *  - o agente volta inteiro do modelo, mas os materiais são MESCLADOS: o que o
 *    pedido não citou fica; mesmo nome substitui; "remover" tira só o nomeado;
 *  - o que a pessoa decidiu na revisão (incluir no coordenador, fluxos,
 *    materiais existentes ligados) o modelo não desfaz;
 *  - anexo marcado "guardar" vira documento uma vez só, e sai ao desmarcar.
 */

const FLUXO = "11111111-1111-4111-8111-111111111111";
const FONTE = "22222222-2222-4222-8222-222222222222";

function previa(over: Partial<PreviaGerada> = {}): PreviaGerada {
  return {
    nome: "Bia",
    descricao: "Atende a clínica",
    system_prompt: "Quem você é: a Bia, da Clínica Sorriso.",
    pacotes: ["atender"],
    handoff_keywords: ["atendente"],
    materiais: [
      { tipo: "faq", nome: "Perguntas frequentes", itens: [{ pergunta: "Abre sábado?", resposta: "Sim." }] },
      { tipo: "documento", nome: "Política de troca", texto: "Troca em 7 dias." },
      { tipo: "documento", nome: "Manual de conduta — Bia", texto: "Seja cordial." },
    ],
    lacunas: [],
    coordenacao: { incluir: false, quando_usar: "Clínica", exemplos: [], nao_usar: [], fluxos_chamaveis: [FLUXO] },
    fontes_existentes: [FONTE],
    ...over,
  };
}

function saida(over: Partial<z.infer<typeof saidaDoRefinoSchema>> = {}): z.infer<typeof saidaDoRefinoSchema> {
  return {
    explicacao: "Deixei o tom mais formal.",
    agente: {
      nome: "Bia",
      descricao: "Atende a clínica",
      system_prompt: "Quem você é: a Bia, assistente da Clínica Sorriso. Tom formal.",
      pacotes: ["atender", "escalar"],
      handoff_keywords: ["atendente", "humano"],
      lacunas: [],
      coordenacao: { quando_usar: "Dúvidas da clínica", exemplos: ["Abre sábado?"], nao_usar: [] },
    },
    materiais_novos: [],
    materiais_remover: [],
    ...over,
  };
}

describe("mesclarRefino", () => {
  it("pedido que não mexe em material: o agente muda, os materiais ficam todos", () => {
    const nova = mesclarRefino(previa(), saida());
    expect(nova.system_prompt).toContain("Tom formal");
    expect(nova.pacotes).toEqual(["atender", "escalar"]);
    expect(nova.materiais.map((m) => m.nome)).toEqual(["Perguntas frequentes", "Política de troca", "Manual de conduta — Bia"]);
  });

  it("mesmo nome substitui (sem duplicar); nome novo acrescenta", () => {
    const nova = mesclarRefino(
      previa(),
      saida({
        materiais_novos: [
          { tipo: "documento", nome: "política de troca", texto: "Troca em 30 dias." },
          { tipo: "documento", nome: "Formas de pagamento", texto: "Pix e cartão." },
        ],
      }),
    );
    const nomes = nova.materiais.map((m) => m.nome.toLowerCase());
    expect(nomes.filter((n) => n === "política de troca")).toHaveLength(1);
    expect(nova.materiais.find((m) => m.nome.toLowerCase() === "política de troca")?.texto).toBe("Troca em 30 dias.");
    expect(nomes).toContain("formas de pagamento");
    expect(nomes).toContain("perguntas frequentes");
  });

  it("remover tira só o nomeado", () => {
    const nova = mesclarRefino(previa(), saida({ materiais_remover: [" Política de Troca "] }));
    expect(nova.materiais.map((m) => m.nome)).toEqual(["Perguntas frequentes", "Manual de conduta — Bia"]);
  });

  it("o que a pessoa decidiu na revisão não é desfeito pelo modelo", () => {
    const nova = mesclarRefino(previa(), saida());
    expect(nova.coordenacao?.incluir).toBe(false);
    expect(nova.coordenacao?.fluxos_chamaveis).toEqual([FLUXO]);
    expect(nova.coordenacao?.quando_usar).toBe("Dúvidas da clínica");
    expect(nova.fontes_existentes).toEqual([FONTE]);
  });

  it("nunca passa do teto de materiais", () => {
    const muitos = Array.from({ length: TETO_DE_MATERIAIS }, (_, i) => ({
      tipo: "documento" as const,
      nome: `Novo ${i}`,
      texto: "x",
    }));
    expect(mesclarRefino(previa(), saida({ materiais_novos: muitos })).materiais).toHaveLength(TETO_DE_MATERIAIS);
  });
});

describe("descreverPrevia", () => {
  it("mostra o prompt inteiro e só o começo de cada material", () => {
    const longo = "a".repeat(5_000);
    const texto = descreverPrevia(previa({ materiais: [{ tipo: "documento", nome: "Longo", texto: longo }] }));
    expect(texto).toContain("Quem você é: a Bia, da Clínica Sorriso.");
    expect(texto).not.toContain(longo);
  });
});

describe("sincronizarAnexosGuardados", () => {
  const anexo = (nome: string, guardar: boolean) => ({ nome, texto: `conteúdo de ${nome}`, guardar });

  it("anexo marcado vira documento com o prefixo; desmarcado não entra", () => {
    const p = sincronizarAnexosGuardados(previa(), [anexo("tabela.pdf", true), anexo("rascunho.txt", false)]);
    const nomes = p.materiais.map((m) => m.nome);
    expect(nomes).toContain(`${PREFIXO_DO_ANEXO}tabela.pdf`);
    expect(nomes).not.toContain(`${PREFIXO_DO_ANEXO}rascunho.txt`);
  });

  it("chamar de novo não duplica; desmarcar tira, e os outros materiais ficam", () => {
    const uma = sincronizarAnexosGuardados(previa(), [anexo("tabela.pdf", true)]);
    const duas = sincronizarAnexosGuardados(uma, [anexo("tabela.pdf", true)]);
    expect(duas.materiais.filter((m) => m.nome.startsWith(PREFIXO_DO_ANEXO))).toHaveLength(1);

    const desmarcado = sincronizarAnexosGuardados(duas, [anexo("tabela.pdf", false)]);
    expect(desmarcado.materiais.map((m) => m.nome)).toEqual(previa().materiais.map((m) => m.nome));
  });

  it("anexo sem texto não vira material vazio", () => {
    const p = sincronizarAnexosGuardados(previa(), [{ nome: "vazio.pdf", texto: "  ", guardar: true }]);
    expect(p.materiais).toHaveLength(3);
  });
});
