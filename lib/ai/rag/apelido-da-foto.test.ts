import { describe, expect, it } from "vitest";

import { apelidoDaFoto } from "./apelido-da-foto";

/**
 * O apelido é o único nome da foto que chega ao modelo. Ele precisa ser
 * ESTÁVEL (o indexador o grava num turno, o envio o recalcula em outro) e não
 * pode carregar o id cru — `projetarRetornoDeTool` cortaria um `*_id`, e UUID
 * no contexto é fonte medida de vazamento para o cliente.
 */

const ID = "33333333-3333-4333-8333-333333333333";

describe("apelidoDaFoto", () => {
  it("tem o formato foto- + 8 hex", () => {
    expect(apelidoDaFoto(ID)).toMatch(/^foto-[0-9a-f]{8}$/);
  });

  it("é estável: o mesmo id dá sempre o mesmo apelido", () => {
    expect(apelidoDaFoto(ID)).toBe(apelidoDaFoto(ID));
  });

  it("ids diferentes dão apelidos diferentes", () => {
    expect(apelidoDaFoto(ID)).not.toBe(apelidoDaFoto("44444444-4444-4444-8444-444444444444"));
  });

  it("não vaza nenhum pedaço do id", () => {
    const id = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    expect(apelidoDaFoto(id)).not.toContain("a1b2c3d4");
  });
});
