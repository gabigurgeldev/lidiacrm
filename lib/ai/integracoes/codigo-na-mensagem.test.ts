import { describe, expect, it } from "vitest";

import { extrairCodigo } from "./codigo-na-mensagem";

describe("extrairCodigo", () => {
  it.each([
    ["482913", "482913"],
    ["o código é 482913", "482913"],
    ["482 913", "482913"],
    ["482-913", "482913"],
    ["Código: 004213.", "004213"],
  ])("lê %s", (texto, esperado) => expect(extrairCodigo(texto)).toBe(esperado));

  it.each([
    ["sem código"],
    ["12345"],
    ["1234567"],
    ["482913 e 112233"],
    ["meu telefone é 11 98765-4321"],
    ["482913, meu cep é 01310-100"],
    [null],
  ])("não adivinha: %s", (texto) => expect(extrairCodigo(texto)).toBeNull());
});
