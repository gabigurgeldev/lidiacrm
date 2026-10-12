import { describe, expect, it } from "vitest";

import { assuntosEmAberto, decidirRodada, perguntasDeReserva, type CoberturaDoAssunto } from "./cobertura";
import { ASSUNTOS, ASSUNTOS_ESSENCIAIS, MAX_PERGUNTAS_POR_RODADA, MAX_RODADAS, promptDaEntrevista } from "./entrevista";
import type { EntrevistaNormalizada } from "./esquemas";

const PRONTO: EntrevistaNormalizada = { kind: "pronto", resumo: "Agente da floricultura.", nicho: "loja" };
const PERGUNTA: EntrevistaNormalizada = {
  kind: "perguntar",
  perguntas: [{ pergunta: "Entrega no mesmo dia?", opcoes: ["Sim", "Não"], resposta_livre: false, sugestao: null }],
  nicho: "loja",
};
const SEM_PERGUNTA: EntrevistaNormalizada = { kind: "perguntar", perguntas: [], nicho: "loja" };

const tudo = (estado: CoberturaDoAssunto["estado"]): CoberturaDoAssunto[] =>
  ASSUNTOS.map((assunto) => ({ assunto, estado }));
const essenciaisCobertos = (): CoberturaDoAssunto[] =>
  ASSUNTOS.map((assunto) => ({ assunto, estado: ASSUNTOS_ESSENCIAIS.includes(assunto) ? "coberto" : "faltando" }));

describe("decidirRodada — quem encerra a entrevista é o servidor", () => {
  it("cabem TRÊS rodadas de perguntas: a terceira ainda pergunta, só a quarta encerra", () => {
    // Sabotagem medida: trocar `rodada > MAX_RODADAS` por `>=` deixa a
    // rodada 3 em "pronto" — e é o defeito que fazia só caberem duas.
    expect(MAX_RODADAS).toBe(3);
    expect(decidirRodada(PERGUNTA, tudo("faltando"), 3)).toEqual({ kind: "aceitar", saida: PERGUNTA });
    expect(decidirRodada(PERGUNTA, tudo("faltando"), 4).kind).toBe("aceitar");
    const depois = decidirRodada(PERGUNTA, tudo("faltando"), 4);
    expect(depois.kind === "aceitar" && depois.saida.kind).toBe("pronto");
  });

  it("texto rico na rodada 1: 'pronto' só é aceito com o checklist INTEIRO coberto", () => {
    expect(decidirRodada(PRONTO, essenciaisCobertos(), 1)).toMatchObject({ kind: "refazer", motivo: "pronto_cedo" });
    expect(decidirRodada(PRONTO, tudo("coberto"), 1)).toEqual({ kind: "aceitar", saida: PRONTO });
  });

  it("da rodada 2 em diante, basta o essencial", () => {
    expect(decidirRodada(PRONTO, essenciaisCobertos(), 2)).toEqual({ kind: "aceitar", saida: PRONTO });
    expect(decidirRodada(PRONTO, tudo("parcial"), 2)).toMatchObject({ kind: "refazer" });
  });

  it("rodada sem pergunta válida é refeita, nunca vira 'pronto' em silêncio", () => {
    expect(decidirRodada(SEM_PERGUNTA, tudo("faltando"), 1)).toMatchObject({ kind: "refazer", motivo: "sem_pergunta" });
  });

  it("assunto que o modelo não citou conta como faltando (silêncio não é evidência)", () => {
    expect(assuntosEmAberto([])).toEqual([...ASSUNTOS_ESSENCIAIS, ...ASSUNTOS.filter((a) => !ASSUNTOS_ESSENCIAIS.includes(a))]);
  });

  it("essenciais vêm primeiro na lista do que falta", () => {
    const cobertura: CoberturaDoAssunto[] = [{ assunto: "Tom", estado: "faltando" }, ...essenciaisCobertos().filter((c) => c.assunto !== "Oferta")];
    expect(assuntosEmAberto(cobertura)[0]).toBe("Oferta");
  });
});

describe("perguntasDeReserva", () => {
  it("monta uma pergunta por assunto em aberto, até o teto da rodada", () => {
    const ps = perguntasDeReserva(ASSUNTOS);
    expect(ps).toHaveLength(MAX_PERGUNTAS_POR_RODADA);
    for (const p of ps) {
      expect(p.pergunta.trim().endsWith("?")).toBe(true);
      expect(p.resposta_livre || p.opcoes.length >= 2).toBe(true);
    }
  });

  it("nada em aberto, nada de pergunta", () => {
    expect(perguntasDeReserva([])).toEqual([]);
  });
});

describe("promptDaEntrevista", () => {
  it("não manda mais encerrar quando 'o essencial' está coberto", () => {
    const p = promptDaEntrevista("loja", 1);
    expect(p).not.toMatch(/Se o essencial já está coberto/);
    expect(p).toMatch(/cobertura/);
  });

  it("a terceira rodada é anunciada como a última de perguntas, sem mandar encerrar", () => {
    const p = promptDaEntrevista("loja", 3);
    expect(p).toMatch(/última rodada de perguntas/i);
    expect(p).not.toMatch(/responda kind='pronto'\.$/m);
  });

  it("depois da última, manda encerrar", () => {
    expect(promptDaEntrevista("loja", 4)).toMatch(/kind='pronto'/);
  });
});
