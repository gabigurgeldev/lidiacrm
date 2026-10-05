import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { AI_CRED_AES_KEY: "61fb339da2d4c96519bd0116326108e60148e64bcbd4211f1c420f64fffaf18e" },
}));

import {
  LIMITES,
  codigoConfere,
  emailValido,
  gerarCodigo,
  hashDoCodigo,
  hashDoEmail,
  mascararEmail,
  podeEmitirDesafio,
  respostaDoPedidoDeCodigo,
} from "./verificacao";

describe("verificação de identidade — partes puras", () => {
  it("código tem 6 dígitos, com zero à esquerda", () => {
    for (let i = 0; i < 200; i++) expect(gerarCodigo()).toMatch(/^\d{6}$/);
  });

  it("hash do código depende da verificação: o mesmo código não serve em outra", () => {
    const h = hashDoCodigo("v1", "123456");
    expect(codigoConfere("v1", "123456", h)).toBe(true);
    expect(codigoConfere("v2", "123456", h)).toBe(false);
    expect(codigoConfere("v1", "123457", h)).toBe(false);
    expect(h).not.toContain("123456");
  });

  it("hash do e-mail normaliza caixa e espaço e separa por organização", () => {
    expect(hashDoEmail("o1", " Dono@Loja.com ")).toBe(hashDoEmail("o1", "dono@loja.com"));
    expect(hashDoEmail("o1", "dono@loja.com")).not.toBe(hashDoEmail("o2", "dono@loja.com"));
  });

  it("máscara não revela o e-mail", () => {
    expect(mascararEmail("ana.souza@gmail.com")).toBe("a***a@g***l.com");
    expect(mascararEmail("ab@x.io")).toBe("a***@x***.io");
  });

  it("valida e-mail", () => {
    expect(emailValido("dono@loja.com.br")).toBe(true);
    expect(emailValido("dono@loja")).toBe(false);
    expect(emailValido("não é e-mail")).toBe(false);
  });

  it("limites", () => {
    const zero = { conversaUltimaHora: 0, emailUltimoDia: 0, organizacaoUltimaHora: 0 };
    expect(podeEmitirDesafio(zero)).toEqual({ ok: true });
    expect(podeEmitirDesafio({ ...zero, conversaUltimaHora: LIMITES.porConversaPorHora })).toEqual({
      ok: false,
      motivo: "limite_conversa",
    });
    expect(podeEmitirDesafio({ ...zero, emailUltimoDia: LIMITES.porEmailPorDia })).toEqual({
      ok: false,
      motivo: "limite_email",
    });
    expect(podeEmitirDesafio({ ...zero, organizacaoUltimaHora: LIMITES.porOrganizacaoPorHora })).toEqual({
      ok: false,
      motivo: "limite_organizacao",
    });
  });

  it("a resposta ao modelo não tem dígito nenhum (o código nunca vaza para o prompt)", () => {
    expect(respostaDoPedidoDeCodigo("a***a@g***l.com")).not.toMatch(/\d{6}/);
  });
});
