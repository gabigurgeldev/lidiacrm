/**
 * Citação interna da fonte — o que o ATENDENTE vê na Caixa de entrada.
 *
 * "Fonte: Tabela de preços 2026, trecho 3" pelo nome que a pessoa deu ao
 * material, o selo do tipo certo (o tipo antes só existia dentro de
 * `metadata`, e o selo caía sempre no genérico) e a frase leiga para a
 * resposta que não usou o material.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CitationsPanel, rotuloDaFonte } from "@/components/ai/CitationsPanel";
import { isSemFonteMessage } from "@/lib/ai/citations/types";

const id = (texto: string) => texto;

describe("rotuloDaFonte", () => {
  it("nome do material e número do trecho", () => {
    expect(rotuloDaFonte({ source_name: "Tabela de preços 2026", trecho: 3 }, id)).toBe("Fonte: Tabela de preços 2026, trecho 3");
  });

  it("sem número do trecho, só o nome; sem nome (citação antiga), nada", () => {
    expect(rotuloDaFonte({ source_name: "Política de troca" }, id)).toBe("Fonte: Política de troca");
    expect(rotuloDaFonte({ source_type: "faq" }, id)).toBeNull();
  });
});

describe("CitationsPanel", () => {
  it("mostra a fonte pelo nome e o tipo do material", () => {
    render(
      <CitationsPanel
        open
        onOpenChange={() => {}}
        citations={[{ chunk_id: "c1", source_name: "Tabela de preços 2026", trecho: 3, source_type: "documento", score: 0.82, snippet: "Capinha A54: R$ 49,90" }]}
      />,
    );
    expect(screen.getByTestId("citacao-fonte").textContent).toBe("Fonte: Tabela de preços 2026, trecho 3");
    expect(screen.getByText("Documento")).toBeTruthy();
    expect(screen.getByText("82%")).toBeTruthy();
  });

  it("resposta sem trecho: frase leiga, sem jargão", () => {
    render(<CitationsPanel open onOpenChange={() => {}} citations={[]} />);
    expect(screen.getByText("Esta resposta não usou nenhum trecho do material da empresa.")).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/RAG|hits/);
  });
});

describe("isSemFonteMessage", () => {
  it("só a marca explícita do motor conta", () => {
    expect(isSemFonteMessage({ sem_fonte: true })).toBe(true);
    expect(isSemFonteMessage({ sem_fonte: false })).toBe(false);
    expect(isSemFonteMessage({ ai_generated: true })).toBe(false);
    expect(isSemFonteMessage(null)).toBe(false);
  });
});
