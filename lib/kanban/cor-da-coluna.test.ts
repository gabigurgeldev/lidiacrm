import { describe, expect, it } from "vitest";
import { CORES_DE_RESERVA, corDaColuna } from "./cor-da-coluna";

describe("corDaColuna", () => {
  it("a cor escolhida vence sempre", () => {
    expect(corDaColuna("#123456", 3)).toBe("#123456");
  });

  it("sem cor, segue a paleta pela posição e dá a volta", () => {
    expect(corDaColuna(null, 0)).toBe(CORES_DE_RESERVA[0]);
    expect(corDaColuna(undefined, 1)).toBe(CORES_DE_RESERVA[1]);
    expect(corDaColuna(null, CORES_DE_RESERVA.length)).toBe(CORES_DE_RESERVA[0]);
  });

  it("nunca devolve o cinza da borda — a faixa tem de aparecer", () => {
    for (let i = 0; i < 20; i++) expect(corDaColuna(null, i)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("posição inválida (-1 de um findIndex) não quebra", () => {
    expect(corDaColuna(null, -1)).toBe(CORES_DE_RESERVA[CORES_DE_RESERVA.length - 1]);
  });
});
