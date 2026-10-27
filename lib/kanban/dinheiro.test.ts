import { describe, expect, it } from "vitest";

import { centavosParaCampo, formatarReais } from "./dinheiro";

describe("dinheiro do Kanban", () => {
  it("formata em reais sem centavos na vitrine", () => {
    expect(formatarReais(123456).replace(/\s/g, " ")).toBe("R$ 1.235");
  });
  it("respeita a moeda do negócio", () => {
    expect(formatarReais(10000, "USD")).toContain("US$");
  });
  it("moeda inválida não derruba a tela", () => {
    expect(formatarReais(500, "XX")).toBe("5 XX");
  });
  it("campo editável usa vírgula", () => {
    expect(centavosParaCampo(123450)).toBe("1234,50");
    expect(centavosParaCampo(null)).toBe("");
  });
});
