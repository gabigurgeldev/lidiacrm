import { describe, expect, it } from "vitest";

import { chunkDocumento } from "./chunker";

describe("chunkDocumento — o trecho carrega o assunto", () => {
  it("prefixa cada trecho com o caminho de títulos markdown", () => {
    const t = chunkDocumento(
      ["# Política de trocas", "", "## Prazo", "", "Em até 7 dias, com nota fiscal.", "", "## Frete", "", "Por nossa conta."].join("\n"),
    );
    expect(t).toEqual(["Política de trocas › Prazo\nEm até 7 dias, com nota fiscal.", "Política de trocas › Frete\nPor nossa conta."]);
  });

  it("título em maiúsculas (PDF extraído) também abre seção", () => {
    const t = chunkDocumento(["HORÁRIO DE ATENDIMENTO", "Segunda a sexta, 9h às 18h."].join("\n"));
    expect(t).toEqual(["Horário de atendimento\nSegunda a sexta, 9h às 18h."]);
  });

  it("junta blocos pequenos da mesma seção, nunca de seções diferentes", () => {
    const t = chunkDocumento(["# A", "um", "", "dois", "", "# B", "três"].join("\n"));
    expect(t).toEqual(["A\num\n\ndois", "B\ntrês"]);
  });

  it("tabela e lista ficam inteiras num bloco", () => {
    const tabela = ["| Tamanho | Preço |", "| P | 49,90 |", "| M | 59,90 |"];
    const lista = ["- pix", "- cartão", "  em até 3x", "- boleto"];
    const t = chunkDocumento(["# Pagamento", ...lista, "", ...tabela].join("\n"));
    expect(t).toHaveLength(1);
    expect(t[0]).toContain("| M | 59,90 |");
    expect(t[0]).toContain("em até 3x");
  });

  it("respeita o teto: bloco grande é picado e cada pedaço leva o prefixo", () => {
    const frase = "Esta é uma frase de teste bem comum. ";
    const t = chunkDocumento(["# Manual", frase.repeat(80)].join("\n"), { maxChars: 500, overlapChars: 50 });
    expect(t.length).toBeGreaterThan(1);
    for (const pedaco of t) {
      expect(pedaco.startsWith("Manual\n")).toBe(true);
      expect(pedaco.length).toBeLessThanOrEqual(500 + 60);
    }
  });

  it("texto sem título nenhum ainda é dividido (nunca pior que o antigo)", () => {
    expect(chunkDocumento("parágrafo um\n\nparágrafo dois")).toEqual(["parágrafo um\n\nparágrafo dois"]);
    expect(chunkDocumento("")).toEqual([]);
  });

  it("'R$ 10' e linhas com ponto final não viram título", () => {
    const t = chunkDocumento(["R$ 10", "ATENÇÃO.", "texto"].join("\n"));
    expect(t).toEqual(["R$ 10\nATENÇÃO.\ntexto"]);
  });
});
