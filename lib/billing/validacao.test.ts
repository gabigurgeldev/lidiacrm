import { describe, expect, it } from "vitest";

import { bandeiraDoNumero, checkoutSchema, cnpjValido, cpfValido, luhnValido } from "./validacao";

describe("documentos", () => {
  it("CPF válido e inválido", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cpfValido("111.111.111-11")).toBe(false);
  });
  it("CNPJ válido e inválido", () => {
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11.222.333/0001-80")).toBe(false);
    expect(cnpjValido("00.000.000/0000-00")).toBe(false);
  });
});

describe("cartão", () => {
  it("Luhn", () => {
    expect(luhnValido("4111 1111 1111 1111")).toBe(true);
    expect(luhnValido("4111 1111 1111 1112")).toBe(false);
  });
  it("bandeira", () => {
    expect(bandeiraDoNumero("4111111111111111")).toBe("visa");
    expect(bandeiraDoNumero("5555555555554444")).toBe("mastercard");
    expect(bandeiraDoNumero("378282246310005")).toBe("amex");
  });
});

describe("checkoutSchema", () => {
  const titular = {
    nome: "Maria Silva",
    cpfCnpj: "529.982.247-25",
    email: "maria@exemplo.com",
    telefone: "(11) 98765-4321",
    cep: "01310-100",
    numero: "100",
  };
  it("PIX não exige cartão", () => {
    expect(checkoutSchema.safeParse({ metodo: "PIX", titular }).success).toBe(true);
  });
  it("cartão exige cartão", () => {
    expect(checkoutSchema.safeParse({ metodo: "CREDIT_CARD", titular }).success).toBe(false);
  });
  it("cartão vencido é recusado antes de ir ao Asaas", () => {
    const r = checkoutSchema.safeParse({
      metodo: "CREDIT_CARD",
      titular,
      cartao: { numero: "4111111111111111", nome: "MARIA SILVA", mes: "01", ano: "20", cvv: "123" },
    });
    expect(r.success).toBe(false);
  });
  it("cartão válido passa", () => {
    const r = checkoutSchema.safeParse({
      metodo: "CREDIT_CARD",
      titular,
      cartao: { numero: "4111 1111 1111 1111", nome: "MARIA SILVA", mes: "12", ano: "2099", cvv: "123" },
    });
    expect(r.success).toBe(true);
  });
});
