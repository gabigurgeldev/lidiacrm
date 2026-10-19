import { describe, expect, it } from "vitest";

import {
  assinar,
  assinaturaSchema,
  lerAssinatura,
  nomeParaAssinar,
  separarAssinatura,
} from "./index";

describe("assinatura do atendente", () => {
  it("assina com o nome em negrito na primeira linha", () => {
    expect(assinar("Seu pedido saiu.", "Maria")).toBe("*Maria:*\nSeu pedido saiu.");
  });

  it("separar desfaz assinar — inclusive nome com espaço e acento", () => {
    const corpo = "Olá!\nSegunda linha.";
    expect(separarAssinatura(assinar(corpo, "Ana Conceição"))).toEqual({
      nome: "Ana Conceição",
      corpo,
    });
  });

  it("corpo sem prefixo passa intacto", () => {
    expect(separarAssinatura("Oi, tudo bem?")).toEqual({ nome: null, corpo: "Oi, tudo bem?" });
  });

  it("negrito que não é assinatura não é confundido com uma", () => {
    // Sem os dois-pontos dentro do negrito, ou sem a quebra logo depois.
    expect(separarAssinatura("*Promoção* hoje\ntexto").nome).toBeNull();
    expect(separarAssinatura("*Maria:* texto na mesma linha").nome).toBeNull();
  });

  it("nome com * ou quebra de linha é recusado", () => {
    expect(assinaturaSchema.safeParse({ ativa: true, nome: "Ma*ria" }).success).toBe(false);
    expect(assinaturaSchema.safeParse({ ativa: true, nome: "Ma\nria" }).success).toBe(false);
    expect(assinaturaSchema.safeParse({ ativa: true, nome: "   " }).success).toBe(false);
    expect(assinaturaSchema.safeParse({ ativa: true, nome: "x".repeat(41) }).success).toBe(false);
  });

  it("lerAssinatura nunca lança: metadata torto vale como sem assinatura", () => {
    expect(lerAssinatura(null)).toBeNull();
    expect(lerAssinatura({})).toBeNull();
    expect(lerAssinatura({ assinatura: "Maria" })).toBeNull();
    expect(lerAssinatura({ assinatura: { ativa: "sim", nome: "Maria" } })).toBeNull();
    expect(lerAssinatura({ assinatura: { ativa: true, nome: " Maria " } })).toEqual({
      ativa: true,
      nome: "Maria",
    });
  });

  it("nomeParaAssinar só devolve nome com a assinatura ligada", () => {
    expect(nomeParaAssinar({ ativa: false, nome: "Maria" })).toBeNull();
    expect(nomeParaAssinar(null)).toBeNull();
    expect(nomeParaAssinar({ ativa: true, nome: "Maria" })).toBe("Maria");
  });
});
